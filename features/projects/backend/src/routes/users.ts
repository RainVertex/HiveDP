import { Router } from "express";
import { projectsDb } from "@internal/db";
import { taskDto, userSummary } from "../services/dto";

export const usersRoutes: Router = Router();

usersRoutes.get("/me", (req, res) => {
  const me = req.user!;
  res.json(userSummary(me));
});

usersRoutes.get("/users/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 1) {
      res.json([]);
      return;
    }
    const users = await projectsDb.user.findMany({
      where: {
        // Agents are assignable like teammates (assigning one runs it on the task), so they surface here too.
        userKind: { in: ["human", "agent"] },
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { githubLogin: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { displayName: "asc" },
      take: 20,
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        username: u.githubLogin,
        name: u.displayName,
        kind: u.userKind,
      })),
    );
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
