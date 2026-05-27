// Sync engine — orchestrates full + incremental syncs of a Plane integration
// into the local mirror. Runs out-of-band (called from a JobRun, the connect
// flow, or the webhook receiver). Each project is synced in its own
// transaction so a partial failure doesn't leave dangling foreign keys.
//
// Resource ordering matters: states/cycles/modules must be upserted *before*
// work items (work item upsert resolves these as FKs by externalId), and
// work items before their comments.

import { prisma, decryptSecret } from "@internal/db";
import type { Prisma } from "@prisma/client";
import {
  createPlaneClient,
  type PlaneApiWorkspace,
  type PlaneClient,
} from "@internal/plane-client";
import {
  upsertComment,
  upsertCycle,
  upsertLabel,
  upsertMember,
  upsertModule,
  upsertProject,
  upsertState,
  upsertWorkItem,
  upsertWorkspace,
} from "./upsert";
import { autoMapMembers } from "./userMapping";
import { provisionUserTokens } from "./userTokens";
import { isPlaneBotMember } from "./planeBotFilter";

interface PlaneIntegrationConfig {
  baseUrl: string;
  workspaceSlug: string;
  oauthClientId: string;
  oauthClientSecret: string;
  webhookSecret?: string;
}

function readConfig(config: Prisma.JsonValue): PlaneIntegrationConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Plane integration config is missing or malformed");
  }
  const c = config as Record<string, unknown>;
  if (
    typeof c.baseUrl !== "string" ||
    typeof c.workspaceSlug !== "string" ||
    typeof c.oauthClientId !== "string" ||
    typeof c.oauthClientSecret !== "string"
  ) {
    throw new Error(
      "Plane integration config is missing required fields (baseUrl, workspaceSlug, oauthClientId, oauthClientSecret)",
    );
  }
  return {
    baseUrl: c.baseUrl,
    workspaceSlug: c.workspaceSlug,
    oauthClientId: c.oauthClientId,
    oauthClientSecret: c.oauthClientSecret,
    webhookSecret: typeof c.webhookSecret === "string" ? c.webhookSecret : undefined,
  };
}

export function clientForIntegration(config: Prisma.JsonValue): PlaneClient {
  const c = readConfig(config);
  return createPlaneClient({
    baseUrl: c.baseUrl,
    authMode: "oauth",
    clientId: c.oauthClientId,
    clientSecret: decryptSecret(c.oauthClientSecret),
  });
}

export function workspaceSlugOf(config: Prisma.JsonValue): string {
  return readConfig(config).workspaceSlug;
}

export function decryptWebhookSecret(config: Prisma.JsonValue): string | null {
  const c = readConfig(config);
  if (!c.webhookSecret) return null;
  return decryptSecret(c.webhookSecret);
}

export interface FullSyncResult {
  projectCount: number;
  workItemCount: number;
  memberCount: number;
  autoMappedUserCount: number;
}

/** Walks the entire Plane workspace and refreshes every mirror row. */
export async function fullSync(integrationId: string): Promise<FullSyncResult> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, kind: true, enabled: true, config: true },
  });
  if (!integration || integration.kind !== "plane") {
    throw new Error(`Integration ${integrationId} is not a Plane integration`);
  }
  if (!integration.enabled) {
    throw new Error(`Integration ${integrationId} is disabled`);
  }

  const slug = workspaceSlugOf(integration.config);
  const client = clientForIntegration(integration.config);

  // Plane's personal API tokens don't authenticate `GET /workspaces/<slug>/`
  // (that endpoint requires a session). So we never call client.getWorkspace
  // here — instead we list projects and members, and derive the workspace
  // identity from their `workspace` field. listProjects is preferred because
  // it's typically the larger response; we fall back to members if the
  // workspace has zero projects.
  const projectRaws = await client.listProjects(slug);
  const memberRaws = await client.listWorkspaceMembers(slug);

  const workspaceExternalId =
    projectRaws[0]?.workspace ?? memberRaws.find((m) => m.workspace)?.workspace;
  if (!workspaceExternalId) {
    throw new Error(
      `Plane workspace "${slug}" has no projects or members yet — create at least one in Plane and retry the sync.`,
    );
  }
  // Synthesize a workspace record from what we know. The real workspace
  // name lives behind the session-only endpoint; we use the slug as a
  // human-readable placeholder. `raw` keeps the shape downstream consumers
  // expect.
  const synthWs: PlaneApiWorkspace = {
    id: workspaceExternalId,
    slug,
    name: slug,
    logo_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const ws = await upsertWorkspace(prisma, integrationId, synthWs);

  const humanMemberRaws = memberRaws.filter((m) => !isPlaneBotMember(m));

  let memberCount = 0;
  let autoMappedUserCount = 0;
  await prisma.$transaction(async (tx) => {
    await tx.planeMember.deleteMany({
      where: {
        workspaceId: ws.id,
        email: { startsWith: "bot_user_", endsWith: "@plane.so", mode: "insensitive" },
      },
    });
    const upserted: Array<{ id: string; email: string }> = [];
    for (const m of humanMemberRaws) {
      const r = await upsertMember(tx, ws.id, m);
      if (r) upserted.push(r);
    }
    memberCount = upserted.length;
    autoMappedUserCount = await autoMapMembers(tx, upserted);
  });

  const cfg = readConfig(integration.config);
  if (cfg.oauthClientId && cfg.oauthClientSecret) {
    await provisionUserTokens(integrationId, cfg);
  }

  let workItemCount = 0;

  // Per-project transactions: state/labels/cycles/modules/work-items/comments
  // for one project all land atomically. Plane orgs can have many projects
  // (10s-100s) so we don't wrap the outer loop in a single transaction.
  for (const proj of projectRaws) {
    const projItemCount = await syncOneProject(client, slug, integrationId, ws.id, proj);
    workItemCount += projItemCount;
  }

  await prisma.planeSyncCursor.upsert({
    where: { integrationId },
    create: { integrationId, lastFullSyncAt: new Date() },
    update: { lastFullSyncAt: new Date() },
  });

  return {
    projectCount: projectRaws.length,
    workItemCount,
    memberCount,
    autoMappedUserCount,
  };
}

async function syncOneProject(
  client: PlaneClient,
  slug: string,
  integrationId: string,
  workspaceId: string,
  projRaw: Awaited<ReturnType<PlaneClient["listProjects"]>>[number],
): Promise<number> {
  // States/labels/cycles/modules first (cheap, parallel reads).
  const [states, labels, cycles, modules] = await Promise.all([
    client.listStates(slug, projRaw.id),
    client.listLabels(slug, projRaw.id),
    client.listCycles(slug, projRaw.id),
    client.listModules(slug, projRaw.id),
  ]);

  // Work items + comments. Comments are hot per work item — we list them
  // inside the work-item loop below.
  const workItems = await client.listWorkItems(slug, projRaw.id);

  // Fetch all comments in parallel (bounded by Plane's per-IP rate limit —
  // small workspaces this is fine; large workspaces should defer to
  // incremental sync).
  const comments = await Promise.all(
    workItems.map((w) => client.listComments(slug, projRaw.id, w.id).catch(() => [])),
  );

  await prisma.$transaction(
    async (tx) => {
      const proj = await upsertProject(tx, integrationId, workspaceId, projRaw);
      for (const s of states) await upsertState(tx, proj.id, s);
      for (const l of labels) await upsertLabel(tx, proj.id, l);
      for (const c of cycles) await upsertCycle(tx, proj.id, c);
      for (const m of modules) await upsertModule(tx, proj.id, m);

      // Two-pass for work items so parent links resolve. First pass: upsert
      // every item without a parent. Second pass: parents (because Plane
      // doesn't guarantee parents come before children in the API order).
      const ordered = [...workItems.filter((w) => !w.parent), ...workItems.filter((w) => w.parent)];
      const idByExternal = new Map<string, string>();
      for (const w of ordered) {
        const r = await upsertWorkItem(tx, proj.id, w);
        idByExternal.set(w.id, r.id);
      }

      for (let i = 0; i < workItems.length; i++) {
        const w = workItems[i];
        const localId = idByExternal.get(w.id);
        if (!localId) continue;
        for (const c of comments[i] ?? []) {
          await upsertComment(tx, localId, c);
        }
      }
    },
    { timeout: 60_000 },
  );
  return workItems.length;
}

export interface IncrementalSyncResult {
  workItemCount: number;
  scannedProjectCount: number;
}

/** Lighter-weight sync that pulls work items modified since the last full or incremental run. */
export async function incrementalSync(integrationId: string): Promise<IncrementalSyncResult> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, kind: true, enabled: true, config: true },
  });
  if (!integration || integration.kind !== "plane" || !integration.enabled) {
    return { workItemCount: 0, scannedProjectCount: 0 };
  }

  const slug = workspaceSlugOf(integration.config);
  const client = clientForIntegration(integration.config);

  const cursor = await prisma.planeSyncCursor.findUnique({
    where: { integrationId },
  });
  // Use lastWebhookAt OR lastFullSyncAt as the "since" floor — webhooks bring
  // the timeline forward in real time, so prefer the more recent of the two.
  const since =
    cursor?.lastWebhookAt && cursor?.lastFullSyncAt
      ? cursor.lastWebhookAt > cursor.lastFullSyncAt
        ? cursor.lastWebhookAt
        : cursor.lastFullSyncAt
      : (cursor?.lastWebhookAt ??
        cursor?.lastFullSyncAt ??
        new Date(Date.now() - 24 * 60 * 60 * 1000));

  const projects = await prisma.planeProject.findMany({
    where: { integrationId, archivedAt: null },
    select: { id: true, externalId: true },
  });

  let workItemCount = 0;
  for (const p of projects) {
    const items = await client.listWorkItems(slug, p.externalId, { updatedAfter: since });
    if (items.length === 0) continue;
    await prisma.$transaction(async (tx) => {
      for (const w of items) await upsertWorkItem(tx, p.id, w);
    });
    workItemCount += items.length;
  }

  return { workItemCount, scannedProjectCount: projects.length };
}
