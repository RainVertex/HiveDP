import { Router } from "express";
import { projectsDb } from "@internal/db";
import { createLabelSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { labelDto } from "../services/dto";

export const labelsRoutes: Router = Router();

labelsRoutes.get("/labels", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    if (!projectId) {
      res.status(400).json({ error: "projectId query param is required" });
      return;
    }
    const access = await resolveAccess(userId, projectId);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const labels = await projectsDb.label.findMany({
      where: { projectId },
      orderBy: { title: "asc" },
    });
    res.json(labels.map(labelDto));
  } catch (err) {
    next(err);
  }
});

labelsRoutes.post("/labels", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const input = createLabelSchema.parse(req.body);
    const access = await resolveAccess(userId, input.projectId);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const created = await projectsDb.label.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        hexColor: input.hexColor ?? null,
      },
    });
    res.status(201).json(labelDto(created));
  } catch (err) {
    next(err);
  }
});
