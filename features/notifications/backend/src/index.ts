// Notifications REST API plus the transactional notify() fan-out helper.
import { Router } from "express";
import { Prisma, prisma } from "@internal/db";
import type { NotificationDto } from "@internal/shared-types";

export const notificationsRouter: Router = Router();

function toDto(n: {
  id: string;
  kind: string;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: n.id,
    kind: n.kind,
    payload: (n.payload as Record<string, unknown>) ?? {},
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

notificationsRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const unreadOnly = req.query.unread === "true";
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const items = await prisma.notification.findMany({
      where: {
        recipientUserId: req.user.id,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ items: items.map(toDto) });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.get("/unread-count", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const count = await prisma.notification.count({
      where: { recipientUserId: req.user.id, readAt: null },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/:id/read", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Scoped so only the recipient can mark their own notification read.
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, recipientUserId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const result = await prisma.notification.updateMany({
      where: { recipientUserId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ count: result.count });
  } catch (err) {
    next(err);
  }
});

// Creates a notification and fans out matching webhook deliveries; must run in a tx.
export async function notify(
  tx: Prisma.TransactionClient,
  args: {
    recipientUserId: string;
    kind: string;
    payload: Record<string, unknown>;
    // Optional team scope so team-scoped webhooks fire on team events.
    teamId?: string | null;
  },
): Promise<void> {
  await tx.notification.create({
    data: {
      recipientUserId: args.recipientUserId,
      kind: args.kind,
      payload: args.payload as Prisma.InputJsonValue,
    },
  });

  const subs = await tx.webhookSubscription.findMany({
    where: {
      active: true,
      eventKinds: { has: args.kind },
      OR: [
        { ownerUserId: args.recipientUserId },
        ...(args.teamId ? [{ ownerTeamId: args.teamId }] : []),
      ],
    },
    select: { id: true },
  });

  if (subs.length === 0) return;

  await tx.webhookDelivery.createMany({
    data: subs.map((s) => ({
      subscriptionId: s.id,
      eventKind: args.kind,
      payload: args.payload as Prisma.InputJsonValue,
      status: "pending",
      nextAttemptAt: new Date(),
    })),
  });
}
