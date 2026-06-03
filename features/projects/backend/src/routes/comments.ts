import { Router } from "express";
import { projectsDb } from "@internal/db";
import { createCommentSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { commentDto } from "../services/dto";
import { notifyTaskCommented } from "../services/notifications";

export const commentsRoutes: Router = Router();

commentsRoutes.get("/tasks/:id/comments", async (req, res, next) => {
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
    const comments = await projectsDb.taskComment.findMany({
      where: { taskId: req.params.id },
      orderBy: { createdAt: "asc" },
      include: { author: true },
    });
    res.json(comments.map(commentDto));
  } catch (err) {
    next(err);
  }
});

commentsRoutes.post("/tasks/:id/comments", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const task = await projectsDb.task.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, title: true, creatorUserId: true } },
        assignees: { select: { userId: true } },
      },
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
    const input = createCommentSchema.parse(req.body);
    const created = await projectsDb.taskComment.create({
      data: {
        taskId: task.id,
        authorUserId: userId,
        body: input.body,
      },
      include: { author: true },
    });

    const recipientIds = new Set<string>([
      ...(task.project.creatorUserId ? [task.project.creatorUserId] : []),
      ...task.assignees.map((a) => a.userId),
    ]);
    await notifyTaskCommented({
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.project.id,
      projectTitle: task.project.title,
      authorUserId: userId,
      authorName: created.author?.displayName ?? "",
      bodySnippet: input.body.slice(0, 200),
      recipientUserIds: Array.from(recipientIds),
    });

    res.status(201).json(commentDto(created));
  } catch (err) {
    next(err);
  }
});
