// User search endpoint for pickers (mention/assignee autocomplete).
import { Router } from "express";
import { prisma } from "@internal/db";

export const usersRouter: Router = Router();

interface UserSummary {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

usersRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const queryParam = typeof req.query.query === "string" ? req.query.query.trim() : "";
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);

    const where = {
      status: "active",
      ...(queryParam
        ? {
            OR: [
              { displayName: { contains: queryParam, mode: "insensitive" as const } },
              { email: { contains: queryParam, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: limit,
      select: { id: true, displayName: true, email: true, avatarUrl: true },
    });

    const items: UserSummary[] = users.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: u.avatarUrl,
    }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
