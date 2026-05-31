// Catalog-backend public exports and the catalogRouter REST surface for catalog entities.

import { Router } from "express";
import { z } from "zod";
import { prisma, type CatalogEntity } from "@internal/db";
import { CrossOrgOwnerError, registerCatalogEntity } from "./service";
import { getRelationsFor } from "./relations";
import {
  evaluateScorecardsForEntity,
  getScorecardSummariesForEntity,
} from "./scorecards/evaluator";
import { devdocsEntityRouter } from "./devdocs/routes";
import { pipelinesRouter } from "./pipelines/routes";
import type { CatalogEntityLink } from "@internal/shared-types";
import type { User } from "@internal/db";

async function isOwningTeamMember(user: User, ownerTeamIds: string[]): Promise<boolean> {
  if (user.role === "admin") return true;
  if (ownerTeamIds.length === 0) return false;
  const membership = await prisma.teamMembership.findFirst({
    where: { userId: user.id, teamId: { in: ownerTeamIds }, team: { deletedAt: null } },
    select: { teamId: true },
  });
  return membership !== null;
}

export * from "./service";
export { parseCatalogInfo, VALID_KINDS, CATALOG_INFO_FILE_NAMES } from "./discovery/parse";
export type { ParseResult } from "./discovery/parse";
export {
  syncInstallation,
  syncRepo,
  syncRepoByName,
  staleEntitiesForInstallation,
  staleEntityByGithubRepoId,
} from "./github-sync/bulk-sync";
export type { SyncInstallationResult, SyncRepoResult } from "./github-sync/bulk-sync";
export { githubAppWebhookRouter } from "./github-sync/webhook";
export { runReconciliation, fetchGithubState, computeDiff } from "./github-sync/team-sync";
export type {
  ReconciliationResult,
  ReconciliationSource,
  ReconciliationDiff,
} from "./github-sync/team-sync";
export { resolvePendingForUser, expirePendingMemberships } from "./github-sync/pending-membership";
export type { PendingResolutionResult } from "./github-sync/pending-membership";
export { getRelationsFor } from "./relations";
export {
  evaluateScorecardsForEntity,
  evaluateAllScorecards,
  getScorecardSummariesForEntity,
  rollupTier,
} from "./scorecards/evaluator";
export { evaluateRule } from "./scorecards/rules";
export type { RuleContext, RuleOutcome } from "./scorecards/rules";
export { scorecardsRouter } from "./scorecards/routes";
export { getCatalogJobs, scorecardEvaluatorJob, devdocsSyncJob } from "./jobs";
export { pipelinesSyncJob } from "./pipelines/jobs";
export {
  syncEntityPipelines,
  syncAllPipelines,
  type SyncEntityResult,
  type SyncAllResult,
} from "./pipelines/sync";
export { upsertWorkflowRun, upsertDeployment } from "./pipelines/upsert";
export {
  devdocsRouter,
  githubWebhookRouter,
  syncDevDocsForEntity,
  syncAllDevDocs,
  getDevDocsHits,
  getDevDocsSearchHits,
  computeFreshness,
  resolveDocSource,
  readSpecDocs,
  parseGithubUrl,
} from "./devdocs";

const KIND = z.enum(["service", "api", "library", "website", "database", "infrastructure"]);

const createInput = z.object({
  kind: KIND,
  name: z.string().min(1),
  description: z.string().optional(),
  ownerTeamIds: z.array(z.string().min(1)).optional(),
  repoUrl: z.url().optional(),
  tags: z.array(z.string()).optional(),
  // Required: every catalog entity must belong to exactly one github org.
  accountLogin: z.string().min(1),
});

const patchInput = z.object({
  description: z.string().nullable().optional(),
  ownerTeamIds: z.array(z.string().min(1)).nullable().optional(),
  repoUrl: z.url().nullable().optional(),
  tags: z.array(z.string()).optional(),
  autoApply: z.boolean().optional(),
});

const ENTITY_INCLUDE = { owners: { include: { team: true } } } as const;

type EntityWithOwners = CatalogEntity & {
  owners: Array<{
    team: {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }>;
};

function shapeEntity(
  row: EntityWithOwners | null,
  canViewRestricted = true,
  liveInstallationIds: ReadonlySet<number> = EMPTY_SET,
) {
  if (!row) return null;
  const { owners, yamlSpec, autoApply, ...rest } = row;
  const orphaned = rest.installationId != null && !liveInstallationIds.has(rest.installationId);
  const base = { ...rest, ownerTeams: owners.map((o) => o.team), orphaned };
  if (canViewRestricted) return { ...base, yamlSpec, autoApply };
  return base;
}

const EMPTY_SET: ReadonlySet<number> = new Set();

async function loadLiveInstallationIds(): Promise<ReadonlySet<number>> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github" },
    select: { config: true },
  });
  const out = new Set<number>();
  for (const row of rows) {
    if (!row.config || typeof row.config !== "object" || Array.isArray(row.config)) continue;
    const id = Number((row.config as Record<string, unknown>).installationId);
    if (Number.isFinite(id)) out.add(id);
  }
  return out;
}

export const catalogRouter: Router = Router();

catalogRouter.get("/", async (req, res) => {
  // Non-admins see only entities in their org memberships; admins and ?allOrgs bypass. Empty memberships yields zero rows by design.
  const allOrgs = req.query.allOrgs === "1" || req.query.allOrgs === "true";
  let whereClause: { accountLogin?: { in: string[] } } = {};
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
    whereClause = { accountLogin: { in: logins } };
  }

  const [entities, liveInstallationIds] = await Promise.all([
    prisma.catalogEntity.findMany({
      where: whereClause,
      include: ENTITY_INCLUDE,
      orderBy: { name: "asc" },
    }),
    loadLiveInstallationIds(),
  ]);
  res.json({
    items: entities.map((e) => shapeEntity(e as EntityWithOwners, true, liveInstallationIds)),
  });
});

catalogRouter.post("/", async (req, res) => {
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  // Reject unknown accountLogins, else callers could create entities under fake orgs and bypass the visibility filter.
  const githubIntegrations = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { config: true },
  });
  const validLogins = new Set<string>();
  for (const row of githubIntegrations) {
    const cfg = row.config as { accountLogin?: unknown } | null;
    if (cfg && typeof cfg.accountLogin === "string") validLogins.add(cfg.accountLogin);
  }
  if (!validLogins.has(parsed.data.accountLogin)) {
    return res.status(400).json({
      error: `accountLogin "${parsed.data.accountLogin}" does not match any enabled GitHub integration`,
    });
  }
  let result;
  try {
    result = await registerCatalogEntity(parsed.data, {
      source: "manual",
      sourceRef: req.user?.id ? `user/${req.user.id}` : null,
    });
  } catch (err) {
    if (err instanceof CrossOrgOwnerError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: result.entityId },
    include: ENTITY_INCLUDE,
  });
  res
    .status(result.action === "created" ? 201 : 200)
    .json({ ...shapeEntity(entity as EntityWithOwners | null), action: result.action });
});

catalogRouter.get("/stars", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const rows = await prisma.starredEntity.findMany({
    where: { userId: req.user.id },
    select: { entityId: true },
  });
  res.json({ items: rows.map((r) => r.entityId) });
});

catalogRouter.put("/:id/star", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const entity = await prisma.catalogEntity.findUnique({ where: { id: req.params.id } });
  if (!entity) return res.status(404).json({ error: "Catalog entity not found" });
  await prisma.starredEntity.upsert({
    where: { userId_entityId: { userId: req.user.id, entityId: entity.id } },
    create: { userId: req.user.id, entityId: entity.id },
    update: {},
  });
  res.status(204).end();
});

catalogRouter.delete("/:id/star", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  await prisma.starredEntity.deleteMany({
    where: { userId: req.user.id, entityId: req.params.id },
  });
  res.status(204).end();
});

catalogRouter.post("/drifts/:id/apply", async (req, res) => {
  const drift = await prisma.catalogDrift.findUnique({
    where: { id: req.params.id },
    include: { entity: { include: { owners: true } } },
  });
  if (!drift) return res.status(404).json({ error: "Drift not found" });
  if (drift.status !== "open")
    return res.status(409).json({ error: `drift already ${drift.status}` });

  const diff = drift.diff as { after?: Record<string, unknown> } | null;
  const after = diff?.after ?? {};
  const existingOwnerIds = drift.entity.owners.map((o) => o.teamId);
  const proposedOwnerIds = Array.isArray(after.ownerTeamIds)
    ? (after.ownerTeamIds as unknown[]).filter((v): v is string => typeof v === "string")
    : existingOwnerIds;
  const result = await registerCatalogEntity(
    {
      kind: drift.entity.kind,
      name: drift.entity.name,
      description:
        typeof after.description === "string" ? after.description : drift.entity.description,
      ownerTeamIds: proposedOwnerIds,
      repoUrl: typeof after.repoUrl === "string" ? after.repoUrl : drift.entity.repoUrl,
      tags: Array.isArray(after.tags) ? (after.tags as string[]) : drift.entity.tags,
    },
    { source: drift.entity.source, sourceRef: `drift/${drift.id}` },
  );
  await prisma.catalogDrift.update({
    where: { id: drift.id },
    data: { status: "applied", resolvedAt: new Date() },
  });
  res.json({ id: drift.id, status: "applied", entityId: result.entityId, action: result.action });
});

catalogRouter.post("/drifts/:id/ignore", async (req, res) => {
  const drift = await prisma.catalogDrift.findUnique({ where: { id: req.params.id } });
  if (!drift) return res.status(404).json({ error: "Drift not found" });
  if (drift.status !== "open")
    return res.status(409).json({ error: `drift already ${drift.status}` });
  const updated = await prisma.catalogDrift.update({
    where: { id: drift.id },
    data: { status: "ignored", resolvedAt: new Date() },
  });
  res.json({ id: updated.id, status: updated.status });
});

catalogRouter.get("/:id/overview", async (req, res) => {
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    include: ENTITY_INCLUDE,
  });
  if (!entity) return res.status(404).json({ error: "Catalog entity not found" });
  const ownerTeamIds = (entity as EntityWithOwners).owners.map((o) => o.team.id);
  const canViewRestricted = req.user ? await isOwningTeamMember(req.user, ownerTeamIds) : false;

  const [drifts, openDriftCount, dora, health, scorecards] = await Promise.all([
    prisma.catalogDrift.findMany({
      where: { entityId: entity.id },
      orderBy: { detectedAt: "desc" },
      take: 20,
    }),
    prisma.catalogDrift.count({ where: { entityId: entity.id, status: "open" } }),
    prisma.doraMetricsSnapshot.findMany({
      where: { entityId: entity.id },
      orderBy: { periodEnd: "desc" },
      take: 12,
    }),
    prisma.serviceHealthSample.findMany({
      where: { entityId: entity.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getScorecardSummariesForEntity(entity.id),
  ]);

  res.json({
    entity: shapeEntity(entity as EntityWithOwners, canViewRestricted),
    drifts,
    openDriftCount,
    dora,
    health,
    scorecards,
    links: deriveLinks(entity),
  });
});

catalogRouter.get("/:id/relations", async (req, res) => {
  const exists = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!exists) return res.status(404).json({ error: "Catalog entity not found" });
  const result = await getRelationsFor(req.params.id);
  res.json(result);
});

catalogRouter.get("/:id/scorecards", async (req, res) => {
  const exists = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!exists) return res.status(404).json({ error: "Catalog entity not found" });
  const summaries = await getScorecardSummariesForEntity(req.params.id);
  res.json({ items: summaries });
});

catalogRouter.post("/:id/scorecards/recompute", async (req, res) => {
  const exists = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!exists) return res.status(404).json({ error: "Catalog entity not found" });
  await evaluateScorecardsForEntity(req.params.id);
  const summaries = await getScorecardSummariesForEntity(req.params.id);
  res.json({ items: summaries });
});

// Standalone devdocs routes are mounted separately at /api/devdocs by createServer.ts.
catalogRouter.use("/:id/docs", devdocsEntityRouter);

catalogRouter.use("/", pipelinesRouter);

catalogRouter.get("/:id/audit", async (req, res) => {
  const exists = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!exists) return res.status(404).json({ error: "Catalog entity not found" });
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);
  const events = await prisma.auditEvent.findMany({
    where: { targetKind: "catalog_entity", targetId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, displayName: true, githubLogin: true, avatarUrl: true } },
    },
  });
  res.json({
    items: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: e.actor
        ? {
            id: e.actor.id,
            displayName: e.actor.displayName,
            githubLogin: e.actor.githubLogin,
            avatarUrl: e.actor.avatarUrl,
          }
        : null,
      actorIp: e.actorIp,
      targetKind: e.targetKind,
      targetId: e.targetId,
      requestId: e.requestId,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

catalogRouter.get("/:id", async (req, res) => {
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: req.params.id },
    include: ENTITY_INCLUDE,
  });
  if (!entity) return res.status(404).json({ error: "Catalog entity not found" });
  if (req.user) {
    const ownerTeamIds = (entity as EntityWithOwners).owners.map((o) => o.team.id);
    const canViewRestricted = await isOwningTeamMember(req.user, ownerTeamIds);
    return res.json(shapeEntity(entity as EntityWithOwners, canViewRestricted));
  }
  res.json(shapeEntity(entity as EntityWithOwners, false));
});

function deriveLinks(entity: { repoUrl: string | null; yamlSpec: unknown }): CatalogEntityLink[] {
  const out: CatalogEntityLink[] = [];
  if (entity.repoUrl) out.push({ url: entity.repoUrl, title: "Repository", icon: "github" });
  const yaml = entity.yamlSpec as Record<string, unknown> | null | undefined;
  const meta = yaml?.metadata as Record<string, unknown> | undefined;
  const links = meta?.links;
  if (Array.isArray(links)) {
    for (const l of links) {
      if (!l || typeof l !== "object") continue;
      const url = (l as Record<string, unknown>).url;
      const title = (l as Record<string, unknown>).title;
      const icon = (l as Record<string, unknown>).icon;
      if (typeof url === "string" && typeof title === "string") {
        out.push({ url, title, icon: typeof icon === "string" ? icon : null });
      }
    }
  }
  return out;
}

catalogRouter.patch("/:id", async (req, res) => {
  const parsed = patchInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const existing = await prisma.catalogEntity.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Catalog entity not found" });

  const result = await registerCatalogEntity(
    {
      kind: existing.kind,
      name: existing.name,
      description: parsed.data.description,
      ownerTeamIds: parsed.data.ownerTeamIds === null ? [] : parsed.data.ownerTeamIds,
      repoUrl: parsed.data.repoUrl,
      tags: parsed.data.tags,
    },
    {
      source: "manual",
      sourceRef: req.user?.id ? `user/${req.user.id}` : null,
    },
  );

  // autoApply lives outside the shared-service contract, patch it separately.
  if (parsed.data.autoApply !== undefined) {
    await prisma.catalogEntity.update({
      where: { id: existing.id },
      data: { autoApply: parsed.data.autoApply },
    });
  }

  const entity = await prisma.catalogEntity.findUnique({
    where: { id: result.entityId },
    include: ENTITY_INCLUDE,
  });
  res.json({ ...shapeEntity(entity as EntityWithOwners | null), action: result.action });
});

catalogRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.catalogEntity.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Catalog entity not found" });
  if (existing.staleSince) return res.status(409).json({ error: "Already marked stale" });
  await prisma.catalogEntity.update({
    where: { id: existing.id },
    data: { staleSince: new Date() },
  });
  res.status(204).end();
});
