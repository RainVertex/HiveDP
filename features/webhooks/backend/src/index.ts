// Webhook subscription REST router (CRUD, test ping, delivery history) plus delivery/job re-exports.
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import type { WebhookSubscriptionDto, WebhookDeliveryDto } from "@internal/shared-types";
import { enqueuePing, generateWebhookSecret } from "./delivery";

export {
  attemptDelivery,
  enqueuePing,
  findDueDeliveryIds,
  generateWebhookSecret,
  signBody,
} from "./delivery";

export {
  getWebhookJobs,
  webhookDeliveryRetryJob,
  type WebhookJobContext,
  type WebhookJobDefinition,
  type WebhookJobLogger,
} from "./jobs";

export const webhooksRouter: Router = Router();

type SubRow = Prisma.WebhookSubscriptionGetPayload<true>;
type DeliveryRow = Prisma.WebhookDeliveryGetPayload<true>;

function toSubDto(sub: SubRow, includeSecret = false): WebhookSubscriptionDto {
  return {
    id: sub.id,
    ownerUserId: sub.ownerUserId,
    ownerTeamId: sub.ownerTeamId,
    url: sub.url,
    eventKinds: sub.eventKinds,
    active: sub.active,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    ...(includeSecret ? { secret: sub.secret } : {}),
  };
}

function toDeliveryDto(d: DeliveryRow): WebhookDeliveryDto {
  return {
    id: d.id,
    subscriptionId: d.subscriptionId,
    eventKind: d.eventKind,
    status: d.status as WebhookDeliveryDto["status"],
    attemptCount: d.attemptCount,
    nextAttemptAt: d.nextAttemptAt ? d.nextAttemptAt.toISOString() : null,
    lastAttemptAt: d.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
  };
}

async function assertCanManageTeam(
  userId: string,
  isAdmin: boolean,
  teamSlug: string,
): Promise<{ ok: true; teamId: string } | { ok: false; status: number; error: string }> {
  const team = await prisma.team.findFirst({
    where: { slug: teamSlug, deletedAt: null },
    select: { id: true },
  });
  if (!team) return { ok: false, status: 404, error: "Team not found" };
  if (isAdmin) return { ok: true, teamId: team.id };
  const lead = await prisma.teamMembership.findFirst({
    where: { teamId: team.id, userId, role: "lead" },
    select: { teamId: true },
  });
  if (!lead) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, teamId: team.id };
}

webhooksRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const isAdmin = req.user.role === "admin";
    const teamSlug = typeof req.query.teamSlug === "string" ? req.query.teamSlug : null;

    let where: Prisma.WebhookSubscriptionWhereInput;
    if (teamSlug) {
      const teamCheck = await assertCanManageTeam(req.user.id, isAdmin, teamSlug);
      if (!teamCheck.ok) {
        res.status(teamCheck.status).json({ error: teamCheck.error });
        return;
      }
      where = { ownerTeamId: teamCheck.teamId };
    } else if (isAdmin) {
      where = {};
    } else {
      where = { ownerUserId: req.user.id };
    }

    const subs = await prisma.webhookSubscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: subs.map((s) => toSubDto(s)) });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  url: z.string().url(),
  eventKinds: z.array(z.string().min(1)).min(1),
  teamSlug: z.string().optional(),
});

webhooksRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { url, eventKinds, teamSlug } = parsed.data;

    let ownerUserId: string | null = req.user.id;
    let ownerTeamId: string | null = null;
    if (teamSlug) {
      const teamCheck = await assertCanManageTeam(req.user.id, req.user.role === "admin", teamSlug);
      if (!teamCheck.ok) {
        res.status(teamCheck.status).json({ error: teamCheck.error });
        return;
      }
      ownerUserId = null;
      ownerTeamId = teamCheck.teamId;
    }

    const secret = generateWebhookSecret();
    const sub = await prisma.$transaction(async (tx) => {
      const created = await tx.webhookSubscription.create({
        data: {
          ownerUserId,
          ownerTeamId,
          url,
          secret,
          eventKinds,
          active: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: req.user!.id,
          actorIp: req.ip ?? null,
          requestId: req.id != null ? String(req.id) : null,
          kind: "webhook.subscription.created",
          targetKind: "webhookSubscription",
          targetId: created.id,
          payload: {
            subscriptionId: created.id,
            ownerUserId: ownerUserId ?? undefined,
            ownerTeamId: ownerTeamId ?? undefined,
            eventKinds,
          },
        },
      });
      return created;
    });
    // Secret is returned only here on create, never by GET endpoints again.
    res.status(201).json(toSubDto(sub, true));
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  active: z.boolean().optional(),
  eventKinds: z.array(z.string().min(1)).min(1).optional(),
});

async function loadSubscriptionForActor(
  id: string,
  user: { id: string; role: string },
): Promise<{ sub: SubRow } | { error: string; status: number }> {
  const sub = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!sub) return { error: "Subscription not found", status: 404 };
  if (user.role === "admin") return { sub };
  if (sub.ownerUserId === user.id) return { sub };
  if (sub.ownerTeamId) {
    const lead = await prisma.teamMembership.findFirst({
      where: { teamId: sub.ownerTeamId, userId: user.id, role: "lead" },
      select: { teamId: true },
    });
    if (lead) return { sub };
  }
  return { error: "Forbidden", status: 403 };
}

webhooksRouter.patch("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const guard = await loadSubscriptionForActor(req.params.id, req.user);
    if ("error" in guard) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const updated = await prisma.webhookSubscription.update({
      where: { id: guard.sub.id },
      data: parsed.data,
    });
    res.json(toSubDto(updated));
  } catch (err) {
    next(err);
  }
});

webhooksRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const guard = await loadSubscriptionForActor(req.params.id, req.user);
    if ("error" in guard) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.webhookSubscription.delete({ where: { id: guard.sub.id } });
      await tx.auditEvent.create({
        data: {
          actorUserId: req.user!.id,
          actorIp: req.ip ?? null,
          requestId: req.id != null ? String(req.id) : null,
          kind: "webhook.subscription.deleted",
          targetKind: "webhookSubscription",
          targetId: guard.sub.id,
          payload: { subscriptionId: guard.sub.id },
        },
      });
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

webhooksRouter.post("/:id/test", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const guard = await loadSubscriptionForActor(req.params.id, req.user);
    if ("error" in guard) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const deliveryId = await enqueuePing(guard.sub.id, {
      ping: true,
      sentAt: new Date().toISOString(),
    });
    res.status(202).json({ deliveryId });
  } catch (err) {
    next(err);
  }
});

webhooksRouter.get("/:id/deliveries", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const guard = await loadSubscriptionForActor(req.params.id, req.user);
    if ("error" in guard) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const items = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: guard.sub.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ items: items.map(toDeliveryDto) });
  } catch (err) {
    next(err);
  }
});
