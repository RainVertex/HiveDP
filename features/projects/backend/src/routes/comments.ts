import { Router } from "express";
import { projectsDb } from "@internal/db";
import { createCommentSchema } from "../zod";
import { resolveAccess } from "../services/permissions";
import { commentDto } from "../services/dto";
import { addComment } from "../services/comments";

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
    const input = createCommentSchema.parse(req.body);
    const result = await addComment({
      userId: req.user!.id,
      taskId: req.params.id,
      body: input.body,
    });
    if ("error" in result) {
      const status =
        result.error === "Task not found"
          ? 404
          : result.error === "Write permission required"
            ? 403
            : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(201).json(result.comment);
  } catch (err) {
    next(err);
  }
});
