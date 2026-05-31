import { Router } from "express";
import { prisma } from "@internal/db";
import { addAssigneeSchema, attachLabelSchema, createTaskSchema, updateTaskSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { taskDto, userSummary } from "../services/dto";
import { notifyTaskAssigned } from "../services/notifications";
import { triggerAgentRunForTask } from "../services/agentRuns";

export const tasksRoutes: Router = Router();

const TASK_INCLUDE = {
  assignees: { include: { user: true } },
  labels: { include: { label: true } },
  project: { select: { title: true } },
} as const;

tasksRoutes.get("/projects/:id/tasks", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const tasks = await prisma.task.findMany({
      where: { projectId: req.params.id },
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
      const bucket = await prisma.bucket.findFirst({
        where: { id: input.bucketId, projectId: input.projectId },
        select: { id: true },
      });
      if (!bucket) {
        res.status(400).json({ error: "Bucket does not belong to this project" });
        return;
      }
    }
    const created = await prisma.task.create({
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
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: TASK_INCLUDE,
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
    const existing = await prisma.task.findUnique({
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
    const input = updateTaskSchema.parse(req.body);
    if (input.bucketId) {
      const bucket = await prisma.bucket.findFirst({
        where: { id: input.bucketId, projectId: existing.projectId },
        select: { id: true },
      });
      if (!bucket) {
        res.status(400).json({ error: "Bucket does not belong to this project" });
        return;
      }
    }
    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.done !== undefined ? { done: input.done } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: parseDate(input.dueDate) } : {}),
        ...(input.startDate !== undefined ? { startDate: parseDate(input.startDate) } : {}),
        ...(input.endDate !== undefined ? { endDate: parseDate(input.endDate) } : {}),
        ...(input.percentDone !== undefined ? { percentDone: input.percentDone } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        ...(input.bucketId !== undefined ? { bucketId: input.bucketId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
      include: TASK_INCLUDE,
    });
    res.json(taskDto(updated));
  } catch (err) {
    next(err);
  }
});

tasksRoutes.delete("/tasks/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const existing = await prisma.task.findUnique({
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
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

tasksRoutes.post("/tasks/:id/assignees", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { id: true, title: true } } },
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
    const input = addAssigneeSchema.parse(req.body);
    const target = await prisma.user.findUnique({
      where: { githubLogin: input.username },
    });
    if (!target) {
      res.status(404).json({ error: `No platform user found with username "${input.username}"` });
      return;
    }
    const existed = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: req.params.id, userId: target.id } },
      select: { taskId: true },
    });
    if (!existed) {
      await prisma.taskAssignee.create({
        data: {
          taskId: req.params.id,
          userId: target.id,
          assignedByUserId: userId,
        },
      });
      if (target.userKind === "agent") {
        // Assigning an agent kicks off a run against the task; it reports back as a comment.
        triggerAgentRunForTask({ agentUserId: target.id, taskId: task.id });
      } else if (target.id !== userId) {
        await notifyTaskAssigned({
          taskId: task.id,
          taskTitle: task.title,
          projectId: task.project.id,
          projectTitle: task.project.title,
          recipientUserId: target.id,
        });
      }
    }
    res.status(201).json(userSummary(target));
  } catch (err) {
    next(err);
  }
});

tasksRoutes.delete("/tasks/:id/assignees/:userId", async (req, res, next) => {
  try {
    const actor = req.user!.id;
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
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
    await prisma.taskAssignee.deleteMany({
      where: { taskId: req.params.id, userId: req.params.userId },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

tasksRoutes.post("/tasks/:id/labels", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await prisma.task.findUnique({
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
    const label = await prisma.label.findFirst({
      where: { id: input.labelId, projectId: task.projectId },
      select: { id: true },
    });
    if (!label) {
      res.status(400).json({ error: "Label does not belong to this project" });
      return;
    }
    await prisma.taskLabel.upsert({
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
    const task = await prisma.task.findUnique({
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
    await prisma.taskLabel.deleteMany({
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
