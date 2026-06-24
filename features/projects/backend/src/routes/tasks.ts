import { Router } from "express";
import { projectsDb } from "@internal/db";
import { addAssigneeSchema, attachLabelSchema, createTaskSchema, updateTaskSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { taskDto, TASK_INCLUDE, TASK_INCLUDE_WITH_CHILDREN } from "../services/dto";
import {
  notifyTaskUnassigned,
  notifyTaskUpdated,
  taskNotificationRecipients,
  type TaskChanges,
} from "../services/notifications";
import { assignUserToTask } from "../services/assignees";

export const tasksRoutes: Router = Router();

tasksRoutes.get("/projects/:id/tasks", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const tasks = await projectsDb.task.findMany({
      where: { projectId: req.params.id, parentTaskId: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: TASK_INCLUDE,
    });
    res.json(tasks.map(taskDto));
  } catch (err) {
    next(err);
  }
});

tasksRoutes.post("/tasks", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const input = createTaskSchema.parse(req.body);
    const access = await resolveAccess(userId, input.projectId);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    if (input.bucketId) {
      const bucket = await projectsDb.bucket.findFirst({
        where: { id: input.bucketId, projectId: input.projectId },
        select: { id: true },
      });
      if (!bucket) {
        res.status(400).json({ error: "Bucket does not belong to this project" });
        return;
      }
    }
    const created = await projectsDb.task.create({
      data: {
        projectId: input.projectId,
        bucketId: input.bucketId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        dueDate: parseDate(input.dueDate),
        startDate: parseDate(input.startDate),
        endDate: parseDate(input.endDate),
        position: input.position ?? 0,
        createdByUserId: userId,
      },
      include: TASK_INCLUDE,
    });
    res.status(201).json(taskDto(created));
  } catch (err) {
    next(err);
  }
});

tasksRoutes.get("/tasks/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      include: TASK_INCLUDE_WITH_CHILDREN,
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(userId, task.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(taskDto(task));
  } catch (err) {
    next(err);
  }
});

tasksRoutes.patch("/tasks/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const existing = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        projectId: true,
        title: true,
        done: true,
        priority: true,
        dueDate: true,
        bucketId: true,
        assignees: { select: { userId: true } },
        project: { select: { id: true, title: true, creatorUserId: true } },
      },
    });
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(userId, existing.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const input = updateTaskSchema.parse(req.body);
    if (input.bucketId) {
      const bucket = await projectsDb.bucket.findFirst({
        where: { id: input.bucketId, projectId: existing.projectId },
        select: { id: true },
      });
      if (!bucket) {
        res.status(400).json({ error: "Bucket does not belong to this project" });
        return;
      }
    }

    const changes = diffTaskChanges(existing, input);

    const updated = await projectsDb.$transaction(async (tx) => {
      const next = await tx.task.update({
        where: { id: req.params.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.done !== undefined ? { done: input.done } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueDate !== undefined ? { dueDate: parseDate(input.dueDate) } : {}),
          // A moved deadline re-arms the due-soon reminder.
          ...(changes.dueDate ? { dueReminderSentAt: null } : {}),
          ...(input.startDate !== undefined ? { startDate: parseDate(input.startDate) } : {}),
          ...(input.endDate !== undefined ? { endDate: parseDate(input.endDate) } : {}),
          ...(input.percentDone !== undefined ? { percentDone: input.percentDone } : {}),
          ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
          ...(input.bucketId !== undefined ? { bucketId: input.bucketId } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
        include: TASK_INCLUDE,
      });

      const recipients = taskNotificationRecipients(existing, { excludeUserId: userId });
      if (Object.keys(changes).length > 0 && recipients.length > 0) {
        await notifyTaskUpdated(tx, {
          taskId: next.id,
          taskTitle: next.title,
          projectId: existing.project.id,
          projectTitle: existing.project.title,
          changes,
          recipientUserIds: recipients,
        });
      }
      return next;
    });
    res.json(taskDto(updated));
  } catch (err) {
    next(err);
  }
});

interface TaskFieldSnapshot {
  done: boolean;
  priority: number;
  dueDate: Date | null;
  bucketId: string | null;
}

function diffTaskChanges(
  before: TaskFieldSnapshot,
  input: ReturnType<typeof updateTaskSchema.parse>,
): TaskChanges {
  const changes: TaskChanges = {};
  if (input.done !== undefined && input.done !== before.done) {
    changes.done = { from: before.done, to: input.done };
  }
  if (input.priority !== undefined && input.priority !== before.priority) {
    changes.priority = { from: before.priority, to: input.priority };
  }
  if (input.bucketId !== undefined && input.bucketId !== before.bucketId) {
    changes.bucket = { from: before.bucketId, to: input.bucketId };
  }
  if (input.dueDate !== undefined) {
    const from = before.dueDate ? before.dueDate.toISOString() : null;
    const parsed = parseDate(input.dueDate);
    const to = parsed ? parsed.toISOString() : null;
    if (from !== to) changes.dueDate = { from, to };
  }
  return changes;
}

tasksRoutes.delete("/tasks/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const existing = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(userId, existing.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    await projectsDb.task.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

tasksRoutes.post("/tasks/:id/assignees", async (req, res, next) => {
  try {
    const input = addAssigneeSchema.parse(req.body);
    const outcome = await assignUserToTask({
      actorUserId: req.user!.id,
      taskId: req.params.id,
      assignee: input.username,
    });
    if (outcome.ok) {
      res.status(201).json(outcome.user);
      return;
    }
    const status = {
      task_not_found: 404,
      forbidden: 403,
      not_found: 404,
      ambiguous: 409,
      not_assignable: 400,
    }[outcome.reason];
    res.status(status).json({ error: outcome.error, candidates: outcome.candidates });
  } catch (err) {
    next(err);
  }
});

tasksRoutes.delete("/tasks/:id/assignees/:userId", async (req, res, next) => {
  try {
    const actor = req.user!.id;
    const task = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        projectId: true,
        title: true,
        project: { select: { id: true, title: true } },
      },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(actor, task.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    await projectsDb.$transaction(async (tx) => {
      const removed = await tx.taskAssignee.deleteMany({
        where: { taskId: req.params.id, userId: req.params.userId },
      });
      if (removed.count > 0 && req.params.userId !== actor) {
        await notifyTaskUnassigned(tx, {
          taskId: task.id,
          taskTitle: task.title,
          projectId: task.project.id,
          projectTitle: task.project.title,
          recipientUserId: req.params.userId,
        });
      }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

tasksRoutes.post("/tasks/:id/labels", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(userId, task.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const input = attachLabelSchema.parse(req.body);
    const label = await projectsDb.label.findFirst({
      where: { id: input.labelId, projectId: task.projectId },
      select: { id: true },
    });
    if (!label) {
      res.status(400).json({ error: "Label does not belong to this project" });
      return;
    }
    await projectsDb.taskLabel.upsert({
      where: { taskId_labelId: { taskId: task.id, labelId: label.id } },
      create: { taskId: task.id, labelId: label.id },
      update: {},
    });
    res.status(201).json({ labelId: label.id });
  } catch (err) {
    next(err);
  }
});

tasksRoutes.delete("/tasks/:id/labels/:labelId", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const access = await resolveAccess(userId, task.projectId);
    if (!access) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    await projectsDb.taskLabel.deleteMany({
      where: { taskId: req.params.id, labelId: req.params.labelId },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

function parseDate(input: string | null | undefined): Date | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === "") return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
