// Teams REST router: CRUD, soft-delete/restore, ownership transfer, and membership management.
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend/contract";
import {
  TEAM_DETAIL_INCLUDE,
  audit,
  isTeamManager,
  loadTeamBySlug,
  shapeTeamDetail,
  shapeTeamSummary,
} from "./helpers";

export {
  getTeamJobs,
  githubTeamReconciliationJob,
  teamHardDeleteJob,
  type TeamJobContext,
  type TeamJobDefinition,
  type TeamJobLogger,
} from "./jobs";

export const teamsRouter: Router = Router();

const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase, digits and dashes");

teamsRouter.get("/", async (req, res, next) => {
  try {
    const includeDeleted = req.query.includeDeleted === "true" && req.user?.role === "admin";
    const allOrgs = req.query.allOrgs === "1" || req.query.allOrgs === "true";

    // Non-admins see only teams in their org memberships unless ?allOrgs=1.
    const where: Prisma.TeamWhereInput = includeDeleted ? {} : { deletedAt: null };
    if (!allOrgs && req.user && req.user.role !== "admin") {
      const memberships = await prisma.userOrgMembership.findMany({
        where: { userId: req.user.id },
        select: { accountLogin: true },
      });
      const logins = memberships.map((m) => m.accountLogin);
      if (logins.length === 0) {
        res.json({ items: [] });
        return;
      }
      where.accountLogin = { in: logins };
    }

    const teams = await prisma.team.findMany({
      where,
      include: TEAM_DETAIL_INCLUDE,
      orderBy: { name: "asc" },
    });
    res.json({ items: teams.map(shapeTeamSummary) });
  } catch (err) {
    next(err);
  }
});

teamsRouter.get("/:slug", async (req, res, next) => {
  try {
    const includeDeleted = req.query.includeDeleted === "true" && req.user?.role === "admin";
    const team = await loadTeamBySlug(req.params.slug, { includeDeleted });
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json(shapeTeamDetail(team));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  /** Optional initial lead (User.id). */
  leadUserId: z.string().min(1).optional(),
  // Required so a team's catalog entities never span orgs.
  accountLogin: z.string().min(1),
});

teamsRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const ghIntegrations = await prisma.integration.findMany({
      where: { kind: "github", enabled: true },
      select: { config: true },
    });
    const validLogins = new Set<string>();
    for (const row of ghIntegrations) {
      const cfg = row.config as { accountLogin?: unknown } | null;
      if (cfg && typeof cfg.accountLogin === "string") validLogins.add(cfg.accountLogin);
    }
    if (!validLogins.has(parsed.data.accountLogin)) {
      res.status(400).json({
        error: `accountLogin "${parsed.data.accountLogin}" does not match any enabled GitHub integration`,
      });
      return;
    }

    try {
      const team = await prisma.$transaction(async (tx) => {
        const created = await tx.team.create({
          data: {
            slug: parsed.data.slug,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            accountLogin: parsed.data.accountLogin,
          },
        });
        const leadUserId = parsed.data.leadUserId ?? req.user!.id;
        await tx.teamMembership.create({
          data: { teamId: created.id, userId: leadUserId, role: "lead" },
        });
        await audit(
          tx,
          req,
          "team.created",
          { teamId: created.id, slug: created.slug },
          { kind: "team", id: created.id },
        );
        return created;
      });
      const detail = await loadTeamBySlug(team.slug);
      res.status(201).json(detail ? shapeTeamDetail(detail) : null);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Slug already in use" });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
});

teamsRouter.patch("/:slug", async (req, res, next) => {
  try {
    const team = await loadTeamBySlug(req.params.slug);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!(await isTeamManager(req, team.id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.json(shapeTeamDetail(team));
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.team.update({
          where: { id: team.id },
          data: parsed.data,
        });
        await audit(
          tx,
          req,
          "team.updated",
          {
            teamId: team.id,
            before: { slug: team.slug, name: team.name, description: team.description },
            after: {
              slug: updated.slug,
              name: updated.name,
              description: updated.description,
            },
          },
          { kind: "team", id: team.id },
        );
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Slug already in use" });
        return;
      }
      throw err;
    }
    const fresh = await loadTeamBySlug(parsed.data.slug ?? team.slug);
    res.json(fresh ? shapeTeamDetail(fresh) : null);
  } catch (err) {
    next(err);
  }
});

teamsRouter.delete("/:slug", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const team = await loadTeamBySlug(req.params.slug);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const ownedEntities = await prisma.catalogEntityOwner.count({
      where: { teamId: team.id },
    });
    if (ownedEntities > 0) {
      // Block delete while catalog rows still point at the team, they would dangle past the grace window.
      res.status(409).json({
        error: "Team still owns resources",
        ownedEntities,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: team.id },
        data: { deletedAt: new Date() },
      });
      await audit(
        tx,
        req,
        "team.soft_deleted",
        { teamId: team.id, slug: team.slug },
        { kind: "team", id: team.id },
      );
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

teamsRouter.post("/:slug/restore", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const team = await prisma.team.findFirst({
      where: { slug: req.params.slug, deletedAt: { not: null } },
    });
    if (!team) {
      res.status(404).json({ error: "Soft-deleted team not found" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: team.id }, data: { deletedAt: null } });
      await audit(
        tx,
        req,
        "team.restored",
        { teamId: team.id, slug: team.slug },
        { kind: "team", id: team.id },
      );
    });
    const fresh = await loadTeamBySlug(team.slug);
    res.json(fresh ? shapeTeamDetail(fresh) : null);
  } catch (err) {
    next(err);
  }
});

const transferSchema = z.object({ targetTeamSlug: z.string().min(1) });

teamsRouter.post("/:slug/transfer-ownership", async (req, res, next) => {
  try {
    const fromTeam = await loadTeamBySlug(req.params.slug);
    if (!fromTeam) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!(await isTeamManager(req, fromTeam.id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const toTeam = await loadTeamBySlug(parsed.data.targetTeamSlug);
    if (!toTeam) {
      res.status(404).json({ error: "Target team not found" });
      return;
    }
    if (toTeam.id === fromTeam.id) {
      res.status(400).json({ error: "Source and target teams are the same" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-key catalog ownership, skipping entities the target already owns to avoid a PK collision.
      const fromOwnerships = await tx.catalogEntityOwner.findMany({
        where: { teamId: fromTeam.id },
        select: { entityId: true },
      });
      const targetOwnerships = await tx.catalogEntityOwner.findMany({
        where: { teamId: toTeam.id, entityId: { in: fromOwnerships.map((o) => o.entityId) } },
        select: { entityId: true },
      });
      const targetSet = new Set(targetOwnerships.map((o) => o.entityId));
      const toMove = fromOwnerships.filter((o) => !targetSet.has(o.entityId));

      if (toMove.length > 0) {
        await tx.catalogEntityOwner.createMany({
          data: toMove.map((o) => ({ entityId: o.entityId, teamId: toTeam.id })),
        });
      }
      await tx.catalogEntityOwner.deleteMany({ where: { teamId: fromTeam.id } });

      await audit(
        tx,
        req,
        "team.ownership.transferred",
        {
          fromTeamId: fromTeam.id,
          toTeamId: toTeam.id,
          entityCount: fromOwnerships.length,
        },
        { kind: "team", id: fromTeam.id },
      );

      return { entityCount: fromOwnerships.length };
    });

    res.json({
      from: { teamId: fromTeam.id, slug: fromTeam.slug },
      to: { teamId: toTeam.id, slug: toTeam.slug },
      entityCount: result.entityCount,
    });
  } catch (err) {
    next(err);
  }
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["lead", "member"]).optional(),
});

teamsRouter.post("/:slug/members", async (req, res, next) => {
  try {
    const team = await loadTeamBySlug(req.params.slug);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!(await isTeamManager(req, team.id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const role = parsed.data.role ?? "member";

    const userExists = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true },
    });
    if (!userExists) {
      res.status(400).json({ error: "User not found" });
      return;
    }

    const existing = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: parsed.data.userId } },
    });
    if (existing) {
      res.status(409).json({ error: "Already a member" });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.teamMembership.create({
          data: { teamId: team.id, userId: parsed.data.userId, role },
        });
        await audit(
          tx,
          req,
          "team.member.added",
          { teamId: team.id, userId: parsed.data.userId, role },
          { kind: "team", id: team.id },
        );
        await notify(tx, {
          recipientUserId: parsed.data.userId,
          kind: "team.member.added",
          payload: { teamId: team.id, teamSlug: team.slug, role },
          teamId: team.id,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Already a member" });
        return;
      }
      throw err;
    }

    const fresh = await loadTeamBySlug(team.slug);
    res.status(201).json(fresh ? shapeTeamDetail(fresh) : null);
  } catch (err) {
    next(err);
  }
});

const patchMemberSchema = z.object({ role: z.enum(["lead", "member"]) });

teamsRouter.patch("/:slug/members/:userId", async (req, res, next) => {
  try {
    const team = await loadTeamBySlug(req.params.slug);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!(await isTeamManager(req, team.id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = patchMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const member = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: req.params.userId } },
    });
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (member.role === parsed.data.role) {
      const fresh = await loadTeamBySlug(team.slug);
      res.json(fresh ? shapeTeamDetail(fresh) : null);
      return;
    }

    // Non-admins cannot promote themselves to lead.
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.id === req.params.userId &&
      parsed.data.role === "lead"
    ) {
      res.status(403).json({ error: "Cannot self-promote to lead" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.update({
        where: { teamId_userId: { teamId: team.id, userId: req.params.userId } },
        data: { role: parsed.data.role },
      });
      await audit(
        tx,
        req,
        "team.member.role_changed",
        {
          teamId: team.id,
          userId: req.params.userId,
          before: member.role,
          after: parsed.data.role,
        },
        { kind: "team", id: team.id },
      );
    });

    const fresh = await loadTeamBySlug(team.slug);
    res.json(fresh ? shapeTeamDetail(fresh) : null);
  } catch (err) {
    next(err);
  }
});

teamsRouter.delete("/:slug/members/:userId", async (req, res, next) => {
  try {
    const team = await loadTeamBySlug(req.params.slug);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const member = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: req.params.userId } },
    });
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const isAdmin = req.user?.role === "admin";
    const selfInitiated = req.user?.id === req.params.userId;
    const isLead = !isAdmin && (await isTeamManager(req, team.id));
    if (!isAdmin && !isLead && !selfInitiated) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (member.role === "lead" && selfInitiated && !isAdmin) {
      // Block the last lead from self-removal so the team is never orphaned (admins may override).
      const otherLead = await prisma.teamMembership.findFirst({
        where: { teamId: team.id, role: "lead", NOT: { userId: req.params.userId } },
      });
      if (!otherLead) {
        res.status(409).json({ error: "Transfer lead before leaving" });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.delete({
        where: { teamId_userId: { teamId: team.id, userId: req.params.userId } },
      });
      await audit(
        tx,
        req,
        "team.member.removed",
        {
          teamId: team.id,
          userId: req.params.userId,
          previousRole: member.role,
          selfInitiated,
        },
        { kind: "team", id: team.id },
      );
      if (!selfInitiated) {
        await notify(tx, {
          recipientUserId: req.params.userId,
          kind: "team.member.removed",
          payload: { teamId: team.id, teamSlug: team.slug, previousRole: member.role },
          teamId: team.id,
        });
      }
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

import type { FeatureManifest } from "@internal/feature-host";

export const featureManifest: FeatureManifest = {
  mounts: [{ path: "/api/teams", router: teamsRouter }],
};
