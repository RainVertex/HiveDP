import { Router, type Request } from "express";
import { Prisma, prisma } from "@internal/db";
import type { UserTask } from "@internal/db";
import type { UserTaskDto } from "@internal/shared-types";
import { SEED_TASKS } from "./seeds";

export const onboardingRouter: Router = Router();

function toDto(t: UserTask): UserTaskDto {
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    payload: (t.payload as Record<string, unknown> | null) ?? null,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  };
}

async function audit(
  req: Request,
  kind: "user.task.completed" | "user.task.dismissed",
  payload: Record<string, unknown>,
  target: { kind: string; id: string },
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: req.user?.id ?? null,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
        kind,
        targetKind: target.kind,
        targetId: target.id,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch {
    // best effort
  }
}

async function ensureSeeded(userId: string): Promise<void> {
  const existing = await prisma.userTask.count({ where: { userId } });
  if (existing >= SEED_TASKS.length) return;
  await prisma.userTask.createMany({
    data: SEED_TASKS.map((s) => ({
      userId,
      kind: s.kind,
      payload: s.payload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
}

async function applyAutoCompletions(req: Request, userId: string): Promise<void> {
  const pending = await prisma.userTask.findMany({
    where: { userId, status: "pending", kind: { in: ["team-join"] } },
  });
  if (pending.length === 0) return;

  for (const task of pending) {
    let shouldComplete = false;
    if (task.kind === "team-join") {
      shouldComplete = (await prisma.teamMembership.count({ where: { userId } })) > 0;
    }
    if (shouldComplete) {
      const updated = await prisma.userTask.update({
        where: { id: task.id },
        data: { status: "completed", completedAt: new Date() },
      });
      await audit(
        req,
        "user.task.completed",
        { taskId: updated.id, kind: updated.kind, auto: true },
        { kind: "UserTask", id: updated.id },
      );
    }
  }
}

onboardingRouter.get("/tasks", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const userId = req.user.id;
    await ensureSeeded(userId);
    await applyAutoCompletions(req, userId);
    const items = await prisma.userTask.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items: items.map(toDto) });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post("/tasks/:id/complete", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const userId = req.user.id;
    const task = await prisma.userTask.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.status === "completed") {
      res.json(toDto(task));
      return;
    }
    const updated = await prisma.userTask.update({
      where: { id: task.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await audit(
      req,
      "user.task.completed",
      { taskId: updated.id, kind: updated.kind, auto: false },
      { kind: "UserTask", id: updated.id },
    );
    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post("/tasks/:id/dismiss", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const userId = req.user.id;
    const task = await prisma.userTask.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const updated = await prisma.userTask.update({
      where: { id: task.id },
      data: { status: "dismissed" },
    });
    await audit(
      req,
      "user.task.dismissed",
      { taskId: updated.id, kind: updated.kind },
      { kind: "UserTask", id: updated.id },
    );
    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});
