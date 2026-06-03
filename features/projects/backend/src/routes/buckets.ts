import { Router } from "express";
import { projectsDb } from "@internal/db";
import { createBucketSchema, updateBucketSchema } from "../zod";
import { meetsLevel, resolveAccess } from "../services/permissions";
import { bucketDto } from "../services/dto";

export const bucketsRoutes: Router = Router();

bucketsRoutes.get("/projects/:id/buckets", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const buckets = await projectsDb.bucket.findMany({
      where: { projectId: req.params.id },
      orderBy: { position: "asc" },
    });
    res.json(buckets.map(bucketDto));
  } catch (err) {
    next(err);
  }
});

bucketsRoutes.post("/projects/:id/buckets", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const access = await resolveAccess(userId, req.params.id);
    if (!access) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const input = createBucketSchema.parse(req.body);

    const position = input.position ?? (await nextPosition(req.params.id));
    const created = await projectsDb.bucket.create({
      data: {
        projectId: req.params.id,
        title: input.title,
        position,
        taskLimit: input.taskLimit ?? null,
      },
    });
    res.status(201).json(bucketDto(created));
  } catch (err) {
    next(err);
  }
});

bucketsRoutes.patch("/buckets/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const bucket = await projectsDb.bucket.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
    });
    if (!bucket) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }
    const access = await resolveAccess(userId, bucket.projectId);
    if (!access) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    const input = updateBucketSchema.parse(req.body);
    const updated = await projectsDb.bucket.update({
      where: { id: req.params.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.taskLimit !== undefined ? { taskLimit: input.taskLimit } : {}),
      },
    });
    res.json(bucketDto(updated));
  } catch (err) {
    next(err);
  }
});

bucketsRoutes.delete("/buckets/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const bucket = await projectsDb.bucket.findUnique({
      where: { id: req.params.id },
      select: { id: true, projectId: true },
    });
    if (!bucket) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }
    const access = await resolveAccess(userId, bucket.projectId);
    if (!access) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }
    if (!meetsLevel(access, "write")) {
      res.status(403).json({ error: "Write permission required" });
      return;
    }
    await projectsDb.bucket.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

async function nextPosition(projectId: string): Promise<number> {
  const last = await projectsDb.bucket.findFirst({
    where: { projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
