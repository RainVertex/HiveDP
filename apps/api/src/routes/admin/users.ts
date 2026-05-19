import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type { User } from "@internal/db";
import type { AdminUserRow } from "@internal/shared-types";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";
import { recordAudit } from "../../audit/audit";

export const adminUsersRouter = Router();

adminUsersRouter.use(adminLimiter, requireAuth, requireRole("admin"));

/** Synthetic user that owns org-level resources like the default sidebar pages. */
const SYSTEM_USER_ID = "__system__";

function toRow(u: User): AdminUserRow {
  return {
    id: u.id,
    githubId: u.githubId,
    githubLogin: u.githubLogin,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status as AdminUserRow["status"],
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

adminUsersRouter.get("/", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { id: { not: SYSTEM_USER_ID } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items: users.map(toRow) });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

adminUsersRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }
    if (id === SYSTEM_USER_ID) {
      // Treat as nonexistent rather than 403 — keeps the system row invisible
      // to admins probing the API directly.
      res.status(404).json({ error: "User not found" });
      return;
    }
    const data: { role?: "admin" | "member"; status?: string } = {};
    if (parsed.data.role) data.role = parsed.data.role;
    if (parsed.data.status) data.status = parsed.data.status;

    if (req.user?.id === id && data.role && data.role !== "admin") {
      const otherAdmins = await prisma.user.count({
        where: { role: "admin", id: { not: id } },
      });
      if (otherAdmins === 0) {
        res.status(400).json({ error: "Cannot demote the last admin" });
        return;
      }
    }

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const updated = await prisma.user.update({ where: { id }, data });

    if (data.status === "disabled") {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    if (data.role && data.role !== before.role) {
      await recordAudit(
        req,
        "user.role.changed",
        { userId: id, before: before.role, after: data.role },
        { kind: "user", id },
      );
    }
    if (data.status && data.status !== before.status) {
      await recordAudit(
        req,
        "user.status.changed",
        { userId: id, before: before.status, after: data.status },
        { kind: "user", id },
      );
    }

    res.json(toRow(updated));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }
    if (id === SYSTEM_USER_ID) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (req.user?.id === id) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.role === "admin") {
      const otherAdmins = await prisma.user.count({
        where: { role: "admin", id: { not: id } },
      });
      if (otherAdmins === 0) {
        res.status(400).json({ error: "Cannot delete the last admin" });
        return;
      }
    }

    await prisma.user.delete({ where: { id } });

    await recordAudit(
      req,
      "user.deleted",
      {
        userId: id,
        githubLogin: target.githubLogin,
        email: target.email,
        role: target.role,
      },
      { kind: "user", id },
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
