import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import { VikunjaClient, VikunjaApiError } from "@internal/vikunja-client";
import { getVikunjaToken, invalidateVikunjaToken } from "./auth";
import { handleWebhookEvent } from "./webhook";
import { ensureProjectWebhook } from "./webhookSetup";
import { createHmac, timingSafeEqual } from "node:crypto";

export const vikunjaRouter: Router = Router();

const VIKUNJA_API_URL = process.env.VIKUNJA_API_URL || "http://localhost:3456/api/v1";
const VIKUNJA_WEBHOOK_SECRET = process.env.VIKUNJA_WEBHOOK_SECRET || "";

// -- Schemas --

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  due_date: z.string().optional(),
  bucket_id: z.number().int().optional(),
  project_id: z.string().min(1),
  assignees: z.array(z.object({ id: z.number().int() })).optional(),
  labels: z.array(z.object({ id: z.number().int() })).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  done: z.boolean().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  percent_done: z.number().min(0).max(1).optional(),
  is_favorite: z.boolean().optional(),
  bucket_id: z.number().int().optional(),
  position: z.number().optional(),
  assignees: z.array(z.object({ id: z.number().int() })).optional(),
  labels: z.array(z.object({ id: z.number().int() })).optional(),
});

const addAssigneeSchema = z.object({
  username: z.string().min(1),
});

const addLabelSchema = z.object({
  label_id: z.number().int(),
});

const createLabelSchema = z.object({
  title: z.string().min(1).max(200),
  hex_color: z.string().optional(),
});

const createCommentSchema = z.object({
  comment: z.string().min(1).max(10000),
});

const createBucketSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().optional(),
  limit: z.number().int().min(0).optional(),
});

const updateBucketSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  position: z.number().optional(),
  limit: z.number().int().min(0).optional(),
});

const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  hex_color: z.string().optional(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  is_archived: z.boolean().optional(),
  hex_color: z.string().optional(),
});

const addShareSchema = z.object({
  username: z.string().min(1),
  right: z.number().int().min(0).max(2).optional(),
});

// -- Helpers --

async function clientForUser(userId: string): Promise<VikunjaClient> {
  const token = await getVikunjaToken(userId);
  const client = new VikunjaClient({ baseUrl: VIKUNJA_API_URL, token });

  // Wrap every async method so a 401 triggers a one-time token refresh + retry.
  return new Proxy(client, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function") return original;
      return async (...args: unknown[]) => {
        try {
          return await (original as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (err) {
          if (!(err instanceof VikunjaApiError) || err.status !== 401) throw err;
          invalidateVikunjaToken(userId);
          const freshToken = await getVikunjaToken(userId);
          const refreshed = new VikunjaClient({ baseUrl: VIKUNJA_API_URL, token: freshToken });
          const refreshedFn = Reflect.get(refreshed, prop) as (...a: unknown[]) => Promise<unknown>;
          return await refreshedFn.apply(refreshed, args);
        }
      };
    },
  });
}

function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!VIKUNJA_WEBHOOK_SECRET) return true;
  const expected = createHmac("sha256", VIKUNJA_WEBHOOK_SECRET).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// -- Read routes --

vikunjaRouter.get("/projects", async (req, res) => {
  const projects = await prisma.vikunjaProject.findMany({
    where: { ownerId: req.user!.id, title: { not: "Inbox" } },
    orderBy: { title: "asc" },
    include: { _count: { select: { tasks: true } } },
  });
  res.json(projects);
});

vikunjaRouter.get("/projects/:id", async (req, res) => {
  const userId = req.user!.id;
  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const client = await clientForUser(userId);
  const live = await client.getProject(project.externalId);

  // Vikunja v2 returns max_permission=0 even for shared writers. Resolve the
  // real permission by checking owner first, then the project shares list.
  const meRes = await fetch(`${VIKUNJA_API_URL}/user`, {
    headers: { Authorization: `Bearer ${await getVikunjaToken(userId)}` },
  });
  let effectivePermission = live.max_permission ?? 0;
  if (meRes.ok) {
    const me = (await meRes.json()) as { id: number; username: string };
    if (live.owner?.id === me.id) {
      effectivePermission = 2;
    } else {
      try {
        const shares = await client.listProjectUsers(project.externalId);
        const mine = shares.find((s) => s.username === me.username);
        if (mine) effectivePermission = mine.permission;
      } catch {
        // ignore, fall back to live.max_permission
      }
    }
  }

  res.json({ ...live, max_permission: effectivePermission });
});

vikunjaRouter.get("/projects/:id/tasks", async (req, res) => {
  const userId = req.user!.id;
  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true, id: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  const liveTasks = await client.listTasks(project.externalId);

  // Vikunja v2 stores bucket_id per-view, project-wide listTasks returns bucket_id=0.
  // The /views/:view/tasks endpoint returns buckets with tasks nested, which is the
  // accurate source of task-bucket assignment for the kanban view.
  const taskBucketMap = new Map<number, number>();
  let defaultBucketId: number | null = null;
  try {
    const views = await client.listViews(project.externalId);
    const kanbanView = views.find((v) => v.view_kind === "kanban") ?? views[0];
    if (kanbanView) {
      const kanbanBuckets = await client.listKanbanBuckets(project.externalId, kanbanView.id);
      defaultBucketId = kanbanBuckets[0]?.id ?? null;
      for (const b of kanbanBuckets) {
        for (const t of b.tasks ?? []) {
          taskBucketMap.set(t.id, b.id);
        }
      }
    }
  } catch {
    // bucket info is best-effort; fall through with empty map
  }

  const tasksWithBucket = liveTasks.map((t) => ({
    ...t,
    bucket_id:
      taskBucketMap.get(t.id) ?? (defaultBucketId !== null ? defaultBucketId : (t.bucket_id ?? 0)),
  }));

  const cuidByExtId = new Map<number, string>();
  for (const t of tasksWithBucket) {
    const row = await prisma.vikunjaTask.upsert({
      where: { externalId_projectId: { externalId: t.id, projectId: project.id } },
      create: {
        externalId: t.id,
        projectId: project.id,
        title: t.title,
        description: t.description || null,
        done: t.done,
        priority: t.priority,
        dueDate: t.due_date ? new Date(t.due_date) : null,
        position: t.position,
        externalCreatedAt: new Date(t.created),
        externalUpdatedAt: new Date(t.updated),
      },
      update: {
        title: t.title,
        description: t.description || null,
        done: t.done,
        priority: t.priority,
        dueDate: t.due_date ? new Date(t.due_date) : null,
        position: t.position,
        externalUpdatedAt: new Date(t.updated),
      },
      select: { id: true },
    });
    cuidByExtId.set(t.id, row.id);
  }

  const merged = tasksWithBucket.map((t) => ({
    ...t,
    id: cuidByExtId.get(t.id)!,
    vikunja_id: t.id,
  }));
  res.json(merged);
});

vikunjaRouter.get("/tasks/:id", async (req, res) => {
  const userId = req.user!.id;
  const mirror = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true, projectId: true },
  });
  if (!mirror) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const client = await clientForUser(userId);
  const live = await client.getTask(mirror.externalId);
  res.json({ ...live, platform_project_id: mirror.projectId });
});

vikunjaRouter.get("/tasks/:id/comments", async (req, res) => {
  const userId = req.user!.id;
  const mirror = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!mirror) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const client = await clientForUser(userId);
  const comments = await client.listComments(mirror.externalId);
  res.json(comments);
});

// -- Write routes --

vikunjaRouter.post("/projects", async (req, res) => {
  const userId = req.user!.id;
  const input = createProjectSchema.parse(req.body);

  const client = await clientForUser(userId);
  const created = await client.createProject({
    title: input.title,
    description: input.description,
    hex_color: input.hex_color,
  });

  let integration = await prisma.integration.findFirst({
    where: { kind: "vikunja", enabled: true },
    select: { id: true },
  });
  if (!integration) {
    integration = await prisma.integration.create({
      data: {
        name: "Vikunja",
        kind: "vikunja",
        enabled: true,
        config: { apiUrl: VIKUNJA_API_URL },
      },
      select: { id: true },
    });
  }

  const mirror = await prisma.vikunjaProject.upsert({
    where: { externalId_ownerId: { externalId: created.id, ownerId: userId } },
    create: {
      externalId: created.id,
      ownerId: userId,
      integrationId: integration.id,
      title: created.title,
      description: created.description || null,
      isArchived: created.is_archived,
      externalCreatedAt: new Date(created.created),
      externalUpdatedAt: new Date(created.updated),
    },
    update: {
      title: created.title,
      description: created.description || null,
      externalUpdatedAt: new Date(created.updated),
    },
  });

  res.status(201).json(mirror);
});

vikunjaRouter.patch("/projects/:id", async (req, res) => {
  const userId = req.user!.id;
  const input = updateProjectSchema.parse(req.body);

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  const updated = await client.updateProject(project.externalId, input);

  await prisma.vikunjaProject.update({
    where: { id: req.params.id },
    data: {
      title: updated.title,
      description: updated.description || null,
      isArchived: updated.is_archived,
      externalUpdatedAt: new Date(updated.updated),
    },
  });

  res.json(updated);
});

vikunjaRouter.delete("/projects/:id", async (req, res) => {
  const userId = req.user!.id;

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  await client.deleteProject(project.externalId);
  await prisma.vikunjaProject.deleteMany({ where: { externalId: project.externalId } });

  res.status(204).end();
});

vikunjaRouter.post("/tasks", async (req, res) => {
  const userId = req.user!.id;
  const input = createTaskSchema.parse(req.body);

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: input.project_id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  const { project_id: _omit, ...taskInput } = input;
  const created = await client.createTask(project.externalId, taskInput);

  const localProject = await prisma.vikunjaProject.findFirst({
    where: { externalId: created.project_id, ownerId: userId },
    select: { id: true },
  });

  let bucketId: string | null = null;
  if (created.bucket_id) {
    const bucket = await prisma.vikunjaBucket.findFirst({
      where: { externalId: created.bucket_id, projectId: localProject!.id },
      select: { id: true },
    });
    bucketId = bucket?.id ?? null;
  }

  const mirror = await prisma.vikunjaTask.upsert({
    where: { externalId_projectId: { externalId: created.id, projectId: localProject!.id } },
    create: {
      externalId: created.id,
      projectId: localProject!.id,
      title: created.title,
      description: created.description || null,
      done: created.done,
      bucketId,
      priority: created.priority,
      dueDate: created.due_date ? new Date(created.due_date) : null,
      position: created.position,
      assignees: created.assignees ? JSON.parse(JSON.stringify(created.assignees)) : undefined,
      labelIds: created.labels?.map((l) => l.id) ?? undefined,
      externalCreatedAt: new Date(created.created),
      externalUpdatedAt: new Date(created.updated),
    },
    update: {
      title: created.title,
      description: created.description || null,
      done: created.done,
      bucketId,
      priority: created.priority,
      dueDate: created.due_date ? new Date(created.due_date) : null,
      position: created.position,
      assignees: created.assignees ? JSON.parse(JSON.stringify(created.assignees)) : undefined,
      labelIds: created.labels?.map((l) => l.id) ?? undefined,
      externalUpdatedAt: new Date(created.updated),
    },
  });

  res.status(201).json(mirror);
});

vikunjaRouter.patch("/tasks/:id", async (req, res) => {
  const userId = req.user!.id;
  const input = updateTaskSchema.parse(req.body);

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true, projectId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);

  // Vikunja v2: bucket_id in PATCH /tasks/:id is ignored. To move a task
  // between buckets, we must POST to the per-view bucket-tasks endpoint.
  if (typeof input.bucket_id === "number" && input.bucket_id > 0) {
    const project = await prisma.vikunjaProject.findUnique({
      where: { id: task.projectId },
      select: { externalId: true },
    });
    if (project) {
      try {
        const views = await client.listViews(project.externalId);
        const kanbanView = views.find((v) => v.view_kind === "kanban") ?? views[0];
        if (kanbanView) {
          await client.assignTaskToBucket(
            project.externalId,
            kanbanView.id,
            input.bucket_id,
            task.externalId,
          );
        }
      } catch (err) {
        console.warn("[vikunja patch] bucket assign failed:", err);
      }
    }
  }

  const { bucket_id: _bucketOmit, ...taskUpdate } = input;
  const hasOtherFields = Object.keys(taskUpdate).length > 0;
  const updated = hasOtherFields
    ? await client.updateTask(task.externalId, taskUpdate)
    : await client.getTask(task.externalId);

  let bucketId: string | null = null;
  const effectiveBucketId = input.bucket_id ?? updated.bucket_id;
  if (effectiveBucketId) {
    const bucket = await prisma.vikunjaBucket.findFirst({
      where: { externalId: effectiveBucketId, projectId: task.projectId },
      select: { id: true },
    });
    bucketId = bucket?.id ?? null;
  }

  await prisma.vikunjaTask.update({
    where: { id: req.params.id },
    data: {
      title: updated.title,
      description: updated.description || null,
      done: updated.done,
      bucketId,
      priority: updated.priority,
      dueDate: updated.due_date ? new Date(updated.due_date) : null,
      position: updated.position,
      assignees: updated.assignees ? JSON.parse(JSON.stringify(updated.assignees)) : undefined,
      labelIds: updated.labels?.map((l) => l.id) ?? undefined,
      externalUpdatedAt: new Date(updated.updated),
    },
  });

  res.json(updated);
});

vikunjaRouter.post("/tasks/:id/assignees", async (req, res) => {
  const userId = req.user!.id;
  const input = addAssigneeSchema.parse(req.body);

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  const matches = await client.searchUsers(input.username);
  const target = matches.find((u) => u.username === input.username) ?? matches[0];
  if (!target) {
    res.status(404).json({ error: `No Vikunja user found matching "${input.username}"` });
    return;
  }

  await client.addAssignee(task.externalId, target.id);
  res.status(201).json({ id: target.id, username: target.username, name: target.name });
});

vikunjaRouter.delete("/tasks/:id/assignees/:userId", async (req, res) => {
  const userId = req.user!.id;
  const targetUserId = Number(req.params.userId);
  if (!Number.isFinite(targetUserId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  await client.removeAssignee(task.externalId, targetUserId);
  res.status(204).end();
});

vikunjaRouter.post("/tasks/:id/labels", async (req, res) => {
  const userId = req.user!.id;
  const input = addLabelSchema.parse(req.body);

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  await client.addTaskLabel(task.externalId, input.label_id);
  res.status(201).json({ label_id: input.label_id });
});

vikunjaRouter.delete("/tasks/:id/labels/:labelId", async (req, res) => {
  const userId = req.user!.id;
  const labelId = Number(req.params.labelId);
  if (!Number.isFinite(labelId)) {
    res.status(400).json({ error: "Invalid label id" });
    return;
  }

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  await client.removeTaskLabel(task.externalId, labelId);
  res.status(204).end();
});

vikunjaRouter.get("/labels", async (req, res) => {
  const userId = req.user!.id;
  const client = await clientForUser(userId);
  const labels = await client.listLabels();
  res.json(labels);
});

vikunjaRouter.post("/labels", async (req, res) => {
  const userId = req.user!.id;
  const input = createLabelSchema.parse(req.body);
  const client = await clientForUser(userId);
  const created = await client.createLabel(input);
  res.status(201).json(created);
});

vikunjaRouter.delete("/tasks/:id", async (req, res) => {
  const userId = req.user!.id;

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  await client.deleteTask(task.externalId);
  await prisma.vikunjaTask.delete({ where: { id: req.params.id } });

  res.status(204).end();
});

vikunjaRouter.post("/tasks/:id/comments", async (req, res) => {
  const userId = req.user!.id;
  const input = createCommentSchema.parse(req.body);

  const task = await prisma.vikunjaTask.findUnique({
    where: { id: req.params.id },
    select: { externalId: true },
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const client = await clientForUser(userId);
  const created = await client.createComment(task.externalId, input);

  await prisma.vikunjaComment.upsert({
    where: { externalId_taskId: { externalId: created.id, taskId: req.params.id } },
    create: {
      externalId: created.id,
      taskId: req.params.id,
      authorName: created.author?.name ?? null,
      comment: created.comment,
      externalCreatedAt: new Date(created.created),
      externalUpdatedAt: new Date(created.updated),
    },
    update: {
      comment: created.comment,
      authorName: created.author?.name ?? null,
      externalUpdatedAt: new Date(created.updated),
    },
  });

  res.status(201).json(created);
});

async function resolveKanbanViewId(
  client: VikunjaClient,
  externalProjectId: number,
): Promise<number | null> {
  const views = await client.listViews(externalProjectId);
  const kanban = views.find((v) => v.view_kind === "kanban") ?? views[0];
  return kanban?.id ?? null;
}

vikunjaRouter.get("/projects/:id/buckets", async (req, res) => {
  const userId = req.user!.id;
  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true, id: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const client = await clientForUser(userId);
  const viewId = await resolveKanbanViewId(client, project.externalId);
  if (!viewId) {
    res.json([]);
    return;
  }
  // /views/:view/tasks returns buckets WITH their tasks nested (Vikunja v2 kanban view structure).
  // This gives us accurate task-bucket assignments, since listBuckets returns empty tasks arrays.
  const liveBuckets = await client.listKanbanBuckets(project.externalId, viewId);
  const cuidByExt = new Map<number, string>();
  for (const b of liveBuckets) {
    const row = await prisma.vikunjaBucket.upsert({
      where: { externalId_projectId: { externalId: b.id, projectId: project.id } },
      create: {
        externalId: b.id,
        projectId: project.id,
        title: b.title,
        position: b.position,
        limit: b.limit,
      },
      update: { title: b.title, position: b.position, limit: b.limit },
      select: { id: true },
    });
    cuidByExt.set(b.id, row.id);
  }
  const merged = liveBuckets.map((b) => ({ ...b, platform_id: cuidByExt.get(b.id)! }));
  res.json(merged);
});

vikunjaRouter.post("/projects/:id/buckets", async (req, res) => {
  const userId = req.user!.id;
  const input = createBucketSchema.parse(req.body);

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true, id: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  const viewId = await resolveKanbanViewId(client, project.externalId);
  if (!viewId) {
    res.status(409).json({ error: "Project has no kanban view" });
    return;
  }
  const created = await client.createBucket(project.externalId, viewId, input);

  const mirror = await prisma.vikunjaBucket.upsert({
    where: { externalId_projectId: { externalId: created.id, projectId: project.id } },
    create: {
      externalId: created.id,
      projectId: project.id,
      title: created.title,
      position: created.position,
      limit: created.limit,
    },
    update: {
      title: created.title,
      position: created.position,
      limit: created.limit,
    },
  });

  res.status(201).json(mirror);
});

vikunjaRouter.patch("/buckets/:id", async (req, res) => {
  const userId = req.user!.id;
  const input = updateBucketSchema.parse(req.body);

  const bucket = await prisma.vikunjaBucket.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { externalId: true } } },
  });
  if (!bucket) {
    res.status(404).json({ error: "Bucket not found" });
    return;
  }

  const client = await clientForUser(userId);
  const viewId = await resolveKanbanViewId(client, bucket.project.externalId);
  if (!viewId) {
    res.status(409).json({ error: "Project has no kanban view" });
    return;
  }
  const updated = await client.updateBucket(
    bucket.project.externalId,
    viewId,
    bucket.externalId,
    input,
  );

  const mirror = await prisma.vikunjaBucket.update({
    where: { id: req.params.id },
    data: {
      title: updated.title,
      position: updated.position,
      limit: updated.limit,
    },
  });

  res.json(mirror);
});

vikunjaRouter.delete("/buckets/:id", async (req, res) => {
  const userId = req.user!.id;
  const bucket = await prisma.vikunjaBucket.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { externalId: true } } },
  });
  if (!bucket) {
    res.status(404).json({ error: "Bucket not found" });
    return;
  }
  const client = await clientForUser(userId);
  const viewId = await resolveKanbanViewId(client, bucket.project.externalId);
  if (!viewId) {
    res.status(409).json({ error: "Project has no kanban view" });
    return;
  }
  await client.deleteBucket(bucket.project.externalId, viewId, bucket.externalId);
  await prisma.vikunjaBucket.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

vikunjaRouter.get("/me", async (req, res) => {
  const userId = req.user!.id;
  const token = await getVikunjaToken(userId);
  const meRes = await fetch(`${VIKUNJA_API_URL}/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) {
    res.status(502).json({ error: `Vikunja /user failed: ${meRes.status}` });
    return;
  }
  const me = (await meRes.json()) as { id: number; name: string; username: string };
  res.json({ id: me.id, username: me.username, name: me.name });
});

// -- Project sharing --

vikunjaRouter.get("/projects/:id/shares", async (req, res) => {
  const userId = req.user!.id;
  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const client = await clientForUser(userId);
  const users = await client.listProjectUsers(project.externalId);
  res.json(users);
});

vikunjaRouter.post("/projects/:id/shares", async (req, res) => {
  const userId = req.user!.id;
  const input = addShareSchema.parse(req.body);

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const client = await clientForUser(userId);
  const created = await client.addProjectUser(project.externalId, {
    username: input.username,
    permission: input.right ?? 1,
  });
  res.status(201).json(created);
});

vikunjaRouter.patch("/projects/:id/shares/:username", async (req, res) => {
  const userId = req.user!.id;
  const targetUsername = req.params.username;
  const right = z.number().int().min(0).max(2).parse(req.body.right);

  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const client = await clientForUser(userId);
  const matches = await client.searchUsers(targetUsername);
  const target = matches.find((u) => u.username === targetUsername);
  if (!target) {
    res.status(404).json({ error: `Vikunja user "${targetUsername}" not found` });
    return;
  }
  const updated = await client.updateProjectUser(project.externalId, target.id, {
    permission: right,
  });
  res.json(updated);
});

vikunjaRouter.delete("/projects/:id/shares/:username", async (req, res) => {
  const userId = req.user!.id;
  const targetUsername = req.params.username;
  const project = await prisma.vikunjaProject.findFirst({
    where: { id: req.params.id, ownerId: userId },
    select: { externalId: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const client = await clientForUser(userId);
  const matches = await client.searchUsers(targetUsername);
  const target = matches.find((u) => u.username === targetUsername);
  if (!target) {
    res.status(404).json({ error: `Vikunja user "${targetUsername}" not found` });
    return;
  }
  await client.removeProjectUser(project.externalId, target.id);
  res.status(204).end();
});

vikunjaRouter.get("/users/search", async (req, res) => {
  const userId = req.user!.id;
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1) {
    res.json([]);
    return;
  }
  const client = await clientForUser(userId);
  const users = await client.searchUsers(q);
  res.json(users);
});

// -- Admin / system routes --

// Ensures the Vikunja account exists for the current platform user by running
// the server-to-server OIDC handshake. Vikunja JIT-provisions the account on
// first callback exchange, so a single call here means the user never has to
// visit Vikunja UI to bootstrap their account.
vikunjaRouter.post("/init", async (req, res) => {
  const userId = req.user!.id;
  try {
    const token = await getVikunjaToken(userId);
    const meRes = await fetch(`${VIKUNJA_API_URL}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      res.status(502).json({ error: `Vikunja /user failed: ${meRes.status}` });
      return;
    }
    const me = (await meRes.json()) as {
      id: number;
      name: string;
      username: string;
      settings?: Record<string, unknown> & {
        discoverable_by_name?: boolean;
        discoverable_by_email?: boolean;
      };
    };

    if (me.settings && (!me.settings.discoverable_by_name || !me.settings.discoverable_by_email)) {
      const client = new VikunjaClient({ baseUrl: VIKUNJA_API_URL, token });
      try {
        await client.updateUserSettings({
          ...me.settings,
          discoverable_by_name: true,
          discoverable_by_email: true,
        });
      } catch (settingsErr) {
        console.warn("[vikunja init] failed to update discoverability settings:", settingsErr);
      }
    }

    res.json({ ok: true, vikunjaUser: { id: me.id, name: me.name, username: me.username } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "init failed" });
  }
});

vikunjaRouter.post("/sync", async (req, res) => {
  const apiToken = process.env.VIKUNJA_API_TOKEN;
  let token: string;
  if (apiToken) {
    token = apiToken;
  } else {
    token = await getVikunjaToken(req.user!.id);
  }
  const client = new VikunjaClient({ baseUrl: VIKUNJA_API_URL, token });

  let integration = await prisma.integration.findFirst({
    where: { kind: "vikunja", enabled: true },
    select: { id: true },
  });
  if (!integration) {
    integration = await prisma.integration.create({
      data: {
        name: "Vikunja",
        kind: "vikunja",
        enabled: true,
        config: { apiUrl: VIKUNJA_API_URL },
      },
      select: { id: true },
    });
  }

  const userId = req.user!.id;
  const remoteProjects = await client.listProjects();
  const projectMap = new Map<number, string>();

  for (const rp of remoteProjects.filter((p) => p.title !== "Inbox")) {
    const row = await prisma.vikunjaProject.upsert({
      where: { externalId_ownerId: { externalId: rp.id, ownerId: userId } },
      create: {
        externalId: rp.id,
        ownerId: userId,
        integrationId: integration.id,
        title: rp.title,
        description: rp.description || null,
        isArchived: rp.is_archived,
        externalCreatedAt: new Date(rp.created),
        externalUpdatedAt: new Date(rp.updated),
      },
      update: {
        title: rp.title,
        description: rp.description || null,
        isArchived: rp.is_archived,
        externalUpdatedAt: new Date(rp.updated),
      },
    });
    projectMap.set(rp.id, row.id);
  }

  for (const [extProjectId, localProjectId] of projectMap) {
    await ensureProjectWebhook(client, extProjectId);
    const views = await client.listViews(extProjectId);
    const kanbanView = views.find((v) => v.view_kind === "kanban") ?? views[0];
    const remoteBuckets = kanbanView ? await client.listBuckets(extProjectId, kanbanView.id) : [];
    const bucketMap = new Map<number, string>();
    for (const rb of remoteBuckets) {
      const bRow = await prisma.vikunjaBucket.upsert({
        where: { externalId_projectId: { externalId: rb.id, projectId: localProjectId } },
        create: {
          externalId: rb.id,
          projectId: localProjectId,
          title: rb.title,
          position: rb.position,
          limit: rb.limit,
        },
        update: { title: rb.title, position: rb.position, limit: rb.limit },
      });
      bucketMap.set(rb.id, bRow.id);
    }

    const remoteTasks = await client.listTasks(extProjectId);
    for (const rt of remoteTasks) {
      const bucketId = rt.bucket_id ? (bucketMap.get(rt.bucket_id) ?? null) : null;
      await prisma.vikunjaTask.upsert({
        where: { externalId_projectId: { externalId: rt.id, projectId: localProjectId } },
        create: {
          externalId: rt.id,
          projectId: localProjectId,
          title: rt.title,
          description: rt.description || null,
          done: rt.done,
          bucketId,
          priority: rt.priority,
          dueDate: rt.due_date ? new Date(rt.due_date) : null,
          position: rt.position,
          assignees: rt.assignees ? JSON.parse(JSON.stringify(rt.assignees)) : undefined,
          labelIds: rt.labels?.map((l) => l.id) ?? undefined,
          externalCreatedAt: new Date(rt.created),
          externalUpdatedAt: new Date(rt.updated),
        },
        update: {
          title: rt.title,
          description: rt.description || null,
          done: rt.done,
          bucketId,
          priority: rt.priority,
          dueDate: rt.due_date ? new Date(rt.due_date) : null,
          position: rt.position,
          assignees: rt.assignees ? JSON.parse(JSON.stringify(rt.assignees)) : undefined,
          labelIds: rt.labels?.map((l) => l.id) ?? undefined,
          externalUpdatedAt: new Date(rt.updated),
        },
      });
    }
  }

  res.json({ ok: true, projectCount: projectMap.size });
});

vikunjaRouter.post("/webhook", async (req, res) => {
  if (VIKUNJA_WEBHOOK_SECRET) {
    const signature = (req.headers["x-vikunja-signature"] as string) || "";
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  }

  await handleWebhookEvent(req.body);
  res.status(200).json({ ok: true });
});
