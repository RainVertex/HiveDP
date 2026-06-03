import { Router } from "express";
import { projectsDb } from "@internal/db";
import {
  addShareSchema,
  createProjectSchema,
  updateProjectSchema,
  updateShareSchema,
} from "../zod";
import { meetsLevel, numericToRole, resolveAccess, roleToNumeric } from "../services/permissions";
import { projectDto, shareDto } from "../services/dto";
import { createDefaultBuckets } from "../services/seed";

export const projectsRoutes: Router = Router();

projectsRoutes.get("/projects", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Platform admins see every project at ADMIN, mirroring resolveAccess.
    if (req.user!.role === "admin") {
      const projects = await projectsDb.project.findMany({
        orderBy: { title: "asc" },
        include: { creator: true, _count: { select: { tasks: true } } },
      });
      res.json(projects.map((p) => projectDto(p, 2)));
      return;
    }

    const memberships = await projectsDb.projectMember.findMany({
      where: { userId },
      select: { projectId: true, role: true },
    });
    const memberMap = new Map(memberships.map((m) => [m.projectId, m.role]));
    const projectIds = Array.from(memberMap.keys());

    const projects = await projectsDb.project.findMany({
      where: { id: { in: projectIds } },
      orderBy: { title: "asc" },
      include: { creator: true, _count: { select: { tasks: true } } },
    });

    res.json(
      projects.map((p) =>
        projectDto(p, p.creatorUserId === userId ? 2 : roleToNumeric(memberMap.get(p.id)!)),
      ),
    );
  } catch (err) {
    next(err);
  }
});

projectsRoutes.post("/projects", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const input = createProjectSchema.parse(req.body);

    const project = await projectsDb.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          hexColor: input.hexColor ?? null,
          creatorUserId: userId,
        },
        include: { creator: true, _count: { select: { tasks: true } } },
      });
      await tx.projectMember.create({
        data: { projectId: created.id, userId, role: "ADMIN" },
      });
      await createDefaultBuckets(tx, created.id);
      return created;
    });

    res.status(201).json(projectDto(project, 2));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.get("/projects/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const project = await projectsDb.project.findUnique({
      where: { id: req.params.id },
      include: { creator: true, _count: { select: { tasks: true } } },
    });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(projectDto(project, access.maxPermission));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.patch("/projects/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "admin")) {
      res.status(403).json({ error: "Admin permission required" });
      return;
    }
    const input = updateProjectSchema.parse(req.body);
    const updated = await projectsDb.project.update({
      where: { id: req.params.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.hexColor !== undefined ? { hexColor: input.hexColor } : {}),
      },
      include: { creator: true, _count: { select: { tasks: true } } },
    });
    res.json(projectDto(updated, access.maxPermission));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.delete("/projects/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "admin")) {
      res.status(403).json({ error: "Admin permission required" });
      return;
    }
    await projectsDb.project.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

projectsRoutes.get("/projects/:id/shares", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const members = await projectsDb.projectMember.findMany({
      where: { projectId: req.params.id },
      include: { user: { select: { id: true, githubLogin: true, displayName: true } } },
      orderBy: { addedAt: "asc" },
    });
    res.json(members.map(shareDto));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.post("/projects/:id/shares", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "admin")) {
      res.status(403).json({ error: "Admin permission required" });
      return;
    }
    const input = addShareSchema.parse(req.body);
    const target = await projectsDb.user.findUnique({
      where: { githubLogin: input.username },
    });
    if (!target) {
      res.status(404).json({ error: `No platform user found with username "${input.username}"` });
      return;
    }
    if (target.id === access.project.creatorUserId) {
      res.status(409).json({ error: "Creator already has admin access" });
      return;
    }
    const role = numericToRole(input.right ?? 1);
    const upserted = await projectsDb.projectMember.upsert({
      where: { projectId_userId: { projectId: req.params.id, userId: target.id } },
      create: {
        projectId: req.params.id,
        userId: target.id,
        role,
        addedByUserId: userId,
      },
      update: { role },
      include: { user: { select: { id: true, githubLogin: true, displayName: true } } },
    });
    res.status(201).json(shareDto(upserted));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.patch("/projects/:id/shares/:username", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "admin")) {
      res.status(403).json({ error: "Admin permission required" });
      return;
    }
    const input = updateShareSchema.parse(req.body);
    const target = await projectsDb.user.findUnique({
      where: { githubLogin: req.params.username },
    });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const updated = await projectsDb.projectMember.update({
      where: { projectId_userId: { projectId: req.params.id, userId: target.id } },
      data: { role: numericToRole(input.right) },
      include: { user: { select: { id: true, githubLogin: true, displayName: true } } },
    });
    res.json(shareDto(updated));
  } catch (err) {
    next(err);
  }
});

projectsRoutes.delete("/projects/:id/shares/:username", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "admin")) {
      res.status(403).json({ error: "Admin permission required" });
      return;
    }
    const target = await projectsDb.user.findUnique({
      where: { githubLogin: req.params.username },
    });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await projectsDb.projectMember.deleteMany({
      where: { projectId: req.params.id, userId: target.id },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
