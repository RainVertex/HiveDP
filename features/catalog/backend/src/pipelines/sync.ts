// Cron-driven backfill for workflow runs and deployments; webhooks (./upsert.ts) handle real-time updates.

import { prisma, type CatalogEntity } from "@internal/db";
import { GitHubAppNotConfiguredError, octokitForInstallation } from "@feature/integrations-backend";
import type { Octokit as OctokitClient } from "octokit";

// Backfill window for never-seen entities; bounds cost on long-lived orgs with huge history.
const BACKFILL_DAYS = 14;
// Newest-first cap; webhooks fill in anything dropped beyond this.
const PER_REPO_RUN_CAP = 100;
const PER_REPO_DEPLOYMENT_CAP = 50;

export interface SyncEntityResult {
  entityId: string;
  runsUpserted: number;
  deploymentsUpserted: number;
  error: string | null;
}

interface SyncableEntity extends Pick<CatalogEntity, "id" | "installationId" | "repoUrl"> {
  ownerLogin: string | null;
  repoName: string | null;
}

// Parses owner/name from the https, .git, and git@ repo URL shapes GitHub returns.
function parseRepoUrl(repoUrl: string | null): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  const httpsMatch = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/.exec(repoUrl);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

async function listSyncableEntities(): Promise<SyncableEntity[]> {
  const rows = await prisma.catalogEntity.findMany({
    where: {
      staleSince: null,
      installationId: { not: null },
      githubRepoId: { not: null },
      repoUrl: { not: null },
    },
    select: { id: true, installationId: true, repoUrl: true },
  });
  return rows
    .map((r) => {
      const parsed = parseRepoUrl(r.repoUrl);
      return {
        ...r,
        ownerLogin: parsed?.owner ?? null,
        repoName: parsed?.repo ?? null,
      };
    })
    .filter((r) => r.ownerLogin && r.repoName);
}

async function getCursor(entityId: string) {
  return prisma.pipelineSyncCursor.upsert({
    where: { entityId },
    create: { entityId },
    update: {},
  });
}

async function advanceCursor(
  entityId: string,
  patch: { lastWorkflowSyncAt?: Date; lastDeploymentSyncAt?: Date },
): Promise<void> {
  await prisma.pipelineSyncCursor.update({
    where: { entityId },
    data: patch,
  });
}

async function recordCursorError(entityId: string, message: string): Promise<void> {
  await prisma.pipelineSyncCursor
    .update({
      where: { entityId },
      data: { lastErrorAt: new Date(), lastError: message.slice(0, 500) },
    })
    .catch(() => {
      // Cursor row may not exist yet on a first-time failure; best effort only.
    });
}

function backfillFloor(): Date {
  return new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
}

// Formats a Date for GitHub's `created` filter (e.g. >=2026-05-01T00:00:00Z).
function sinceFilter(d: Date): string {
  return `>=${d.toISOString()}`;
}

interface ListedRun {
  id: number;
  name: string | null;
  path: string;
  run_number: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  html_url: string;
  run_started_at: string | null;
  updated_at: string;
  actor?: { login?: string | null } | null;
}

async function syncWorkflowRuns(
  entity: SyncableEntity,
  octo: OctokitClient,
  since: Date,
): Promise<number> {
  const owner = entity.ownerLogin!;
  const repo = entity.repoName!;

  const res = await octo.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    created: sinceFilter(since),
    per_page: PER_REPO_RUN_CAP,
  });
  const runs = res.data.workflow_runs as ListedRun[];

  let count = 0;
  let newestUpdatedAt = since;

  for (const r of runs) {
    const updatedAt = new Date(r.updated_at);
    if (updatedAt > newestUpdatedAt) newestUpdatedAt = updatedAt;

    const data = {
      entityId: entity.id,
      workflowName: r.name ?? "(unnamed)",
      workflowPath: r.path,
      runNumber: r.run_number,
      event: r.event,
      status: r.status ?? "queued",
      conclusion: r.conclusion ?? null,
      headBranch: r.head_branch,
      headSha: r.head_sha,
      actorLogin: r.actor?.login ?? null,
      htmlUrl: r.html_url,
      runStartedAt: r.run_started_at ? new Date(r.run_started_at) : null,
      runUpdatedAt: updatedAt,
    };

    await prisma.workflowRun.upsert({
      where: { githubRunId: BigInt(r.id) },
      create: { ...data, githubRunId: BigInt(r.id) },
      update: data,
    });
    count++;
  }

  await advanceCursor(entity.id, { lastWorkflowSyncAt: newestUpdatedAt });
  return count;
}

interface ListedDeployment {
  id: number;
  environment: string;
  ref: string;
  sha: string;
  description: string | null;
  url: string;
  creator: { login: string | null } | null;
  created_at: string;
  updated_at: string;
}

interface ListedDeploymentStatus {
  state: string;
  description: string | null;
  log_url: string | null;
  target_url: string | null;
  creator: { login: string | null } | null;
  created_at: string;
  updated_at: string;
}

async function fetchLatestStatus(
  octo: OctokitClient,
  owner: string,
  repo: string,
  deploymentId: number,
): Promise<ListedDeploymentStatus | null> {
  const res = await octo.rest.repos.listDeploymentStatuses({
    owner,
    repo,
    deployment_id: deploymentId,
    per_page: 1,
  });
  const items = res.data as ListedDeploymentStatus[];
  return items.length > 0 ? items[0] : null;
}

async function syncDeployments(
  entity: SyncableEntity,
  octo: OctokitClient,
  since: Date,
): Promise<number> {
  const owner = entity.ownerLogin!;
  const repo = entity.repoName!;

  // The deployments list endpoint has no `since` filter, so pull the recent page and stop at the cursor.
  const res = await octo.rest.repos.listDeployments({
    owner,
    repo,
    per_page: PER_REPO_DEPLOYMENT_CAP,
  });
  const deps = res.data as ListedDeployment[];

  let count = 0;
  let newestUpdatedAt = since;

  for (const d of deps) {
    const updatedAt = new Date(d.updated_at);
    if (updatedAt <= since) continue;
    if (updatedAt > newestUpdatedAt) newestUpdatedAt = updatedAt;

    const status = await fetchLatestStatus(octo, owner, repo, d.id);

    const data = {
      entityId: entity.id,
      environment: d.environment,
      ref: d.ref,
      sha: d.sha,
      state: status?.state ?? "pending",
      actorLogin: status?.creator?.login ?? d.creator?.login ?? null,
      description: status?.description ?? d.description ?? null,
      htmlUrl: `https://github.com/${owner}/${repo}/deployments/${d.id}`,
      logUrl: status?.log_url ?? status?.target_url ?? null,
      deployedAt: status ? new Date(status.updated_at) : new Date(d.updated_at),
    };

    await prisma.deployment.upsert({
      where: { githubDeploymentId: BigInt(d.id) },
      create: { ...data, githubDeploymentId: BigInt(d.id) },
      update: data,
    });
    count++;
  }

  await advanceCursor(entity.id, { lastDeploymentSyncAt: newestUpdatedAt });
  return count;
}

export async function syncEntityPipelines(entityId: string): Promise<SyncEntityResult> {
  const result: SyncEntityResult = {
    entityId,
    runsUpserted: 0,
    deploymentsUpserted: 0,
    error: null,
  };

  const entity = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: { id: true, installationId: true, repoUrl: true },
  });
  if (!entity || entity.installationId == null) {
    result.error = "entity has no GitHub installation";
    return result;
  }
  const parsed = parseRepoUrl(entity.repoUrl);
  if (!parsed) {
    result.error = "entity repoUrl could not be parsed";
    return result;
  }

  const syncable: SyncableEntity = {
    ...entity,
    ownerLogin: parsed.owner,
    repoName: parsed.repo,
  };

  let octo: OctokitClient;
  try {
    octo = await octokitForInstallation(entity.installationId);
  } catch (err) {
    if (err instanceof GitHubAppNotConfiguredError) {
      result.error = "GitHub App not configured";
      return result;
    }
    throw err;
  }

  const cursor = await getCursor(entityId);
  const workflowSince = cursor.lastWorkflowSyncAt ?? backfillFloor();
  const deploymentSince = cursor.lastDeploymentSyncAt ?? backfillFloor();

  try {
    result.runsUpserted = await syncWorkflowRuns(syncable, octo, workflowSince);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await recordCursorError(entityId, result.error);
    return result;
  }

  try {
    result.deploymentsUpserted = await syncDeployments(syncable, octo, deploymentSince);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await recordCursorError(entityId, result.error);
    return result;
  }

  return result;
}

export interface SyncAllResult {
  entitiesExamined: number;
  totalRunsUpserted: number;
  totalDeploymentsUpserted: number;
  errors: Array<{ entityId: string; error: string }>;
}

export async function syncAllPipelines(): Promise<SyncAllResult> {
  const entities = await listSyncableEntities();
  const out: SyncAllResult = {
    entitiesExamined: entities.length,
    totalRunsUpserted: 0,
    totalDeploymentsUpserted: 0,
    errors: [],
  };

  for (const e of entities) {
    const r = await syncEntityPipelines(e.id).catch((err: unknown) => ({
      entityId: e.id,
      runsUpserted: 0,
      deploymentsUpserted: 0,
      error: err instanceof Error ? err.message : String(err),
    }));
    out.totalRunsUpserted += r.runsUpserted;
    out.totalDeploymentsUpserted += r.deploymentsUpserted;
    if (r.error) out.errors.push({ entityId: e.id, error: r.error });
  }

  return out;
}
