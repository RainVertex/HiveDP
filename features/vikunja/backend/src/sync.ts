import { prisma, decryptSecret } from "@internal/db";
import { VikunjaClient } from "@internal/vikunja-client";

interface IntegrationConfig {
  apiUrl: string;
  serviceToken: string;
}

function getConfig(rawConfig: unknown): IntegrationConfig {
  const cfg = rawConfig as Record<string, string>;
  return {
    apiUrl: cfg.apiUrl,
    serviceToken: decryptSecret(cfg.serviceToken),
  };
}

function buildClient(cfg: IntegrationConfig): VikunjaClient {
  return new VikunjaClient({ baseUrl: cfg.apiUrl, token: cfg.serviceToken });
}

async function syncProjects(
  client: VikunjaClient,
  integrationId: string,
  ownerId: string,
): Promise<Map<number, string>> {
  const remoteProjects = await client.listProjects();
  const projectMap = new Map<number, string>();

  for (const rp of remoteProjects) {
    const row = await prisma.vikunjaProject.upsert({
      where: { externalId_ownerId: { externalId: rp.id, ownerId } },
      create: {
        externalId: rp.id,
        ownerId,
        integrationId,
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

  return projectMap;
}

async function syncBuckets(
  client: VikunjaClient,
  externalProjectId: number,
  localProjectId: string,
): Promise<Map<number, string>> {
  const views = await client.listViews(externalProjectId);
  const kanbanView = views.find((v) => v.view_kind === "kanban") ?? views[0];
  if (!kanbanView) return new Map();
  const remoteBuckets = await client.listBuckets(externalProjectId, kanbanView.id);
  const bucketMap = new Map<number, string>();

  for (const rb of remoteBuckets) {
    const row = await prisma.vikunjaBucket.upsert({
      where: { externalId_projectId: { externalId: rb.id, projectId: localProjectId } },
      create: {
        externalId: rb.id,
        projectId: localProjectId,
        title: rb.title,
        position: rb.position,
        limit: rb.limit,
      },
      update: {
        title: rb.title,
        position: rb.position,
        limit: rb.limit,
      },
    });
    bucketMap.set(rb.id, row.id);
  }

  return bucketMap;
}

async function syncLabels(client: VikunjaClient, localProjectId: string): Promise<void> {
  const remoteLabels = await client.listLabels();

  for (const rl of remoteLabels) {
    await prisma.vikunjaLabel.upsert({
      where: { externalId_projectId: { externalId: rl.id, projectId: localProjectId } },
      create: {
        externalId: rl.id,
        projectId: localProjectId,
        title: rl.title,
        hexColor: rl.hex_color || null,
      },
      update: {
        title: rl.title,
        hexColor: rl.hex_color || null,
      },
    });
  }
}

async function syncTasks(
  client: VikunjaClient,
  externalProjectId: number,
  localProjectId: string,
  bucketMap: Map<number, string>,
): Promise<void> {
  const remoteTasks = await client.listTasks(externalProjectId);

  for (const rt of remoteTasks) {
    const bucketId = rt.bucket_id ? (bucketMap.get(rt.bucket_id) ?? null) : null;
    const row = await prisma.vikunjaTask.upsert({
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

    // Sync comments for each task
    const remoteComments = await client.listComments(rt.id);
    for (const rc of remoteComments) {
      await prisma.vikunjaComment.upsert({
        where: { externalId_taskId: { externalId: rc.id, taskId: row.id } },
        create: {
          externalId: rc.id,
          taskId: row.id,
          authorName: rc.author?.name ?? null,
          comment: rc.comment,
          externalCreatedAt: new Date(rc.created),
          externalUpdatedAt: new Date(rc.updated),
        },
        update: {
          comment: rc.comment,
          authorName: rc.author?.name ?? null,
          externalUpdatedAt: new Date(rc.updated),
        },
      });
    }
  }
}

export class VikunjaSyncEngine {
  async fullSync(integrationId: string, ownerId?: string): Promise<void> {
    const integration = await prisma.integration.findUniqueOrThrow({
      where: { id: integrationId },
    });

    const cfg = getConfig(integration.config);
    const client = buildClient(cfg);
    const resolvedOwnerId = ownerId ?? "system";

    const projectMap = await syncProjects(client, integrationId, resolvedOwnerId);

    for (const [externalProjectId, localProjectId] of projectMap) {
      const bucketMap = await syncBuckets(client, externalProjectId, localProjectId);
      await syncLabels(client, localProjectId);
      await syncTasks(client, externalProjectId, localProjectId, bucketMap);
    }

    await prisma.vikunjaSyncCursor.upsert({
      where: { integrationId },
      create: { integrationId, lastSyncedAt: new Date() },
      update: { lastSyncedAt: new Date() },
    });
  }

  async incrementalSync(_integrationId: string): Promise<void> {
    // Placeholder for delta sync using VikunjaSyncCursor.lastSyncedAt
    throw new Error("Incremental sync not yet implemented");
  }
}

export const syncEngine = new VikunjaSyncEngine();
