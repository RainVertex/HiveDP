import { Router } from "express";
import { projectsDb } from "@internal/db";
import { taskDto, userSummary } from "../services/dto";
import { searchAssignableUsers } from "../services/assignees";

export const usersRoutes: Router = Router();

usersRoutes.get("/me", (req, res) => {
  const me = req.user!;
  res.json(userSummary(me));
});

usersRoutes.get("/users/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json(await searchAssignableUsers(q));
  } catch (err) {
    next(err);
  }
});

usersRoutes.get("/users/:userId/tasks", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);
    const tasks = await projectsDb.task.findMany({
      where: {
        assignees: { some: { userId: req.params.userId } },
        done: false,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        assignees: { include: { user: true } },
        labels: { include: { label: true } },
        project: { select: { title: true } },
      },
    });
    res.json(tasks.map(taskDto));
  } catch (err) {
    next(err);
  }
});
