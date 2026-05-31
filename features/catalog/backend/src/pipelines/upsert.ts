// Webhook-driven ingestion for GitHub Actions runs and deployments; upserts on the GitHub-stable id so re-deliveries and the cron sweep converge.

import { prisma } from "@internal/db";

interface RepoRef {
  id: number;
}

function readRepo(payload: Record<string, unknown>): RepoRef | null {
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!repo || typeof repo !== "object") return null;
  const id = repo.id;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  return { id };
}

async function findEntityIdByRepoId(repoId: number): Promise<string | null> {
  const row = await prisma.catalogEntity.findUnique({
    where: { githubRepoId: repoId },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function touchWebhookCursor(entityId: string): Promise<void> {
  const now = new Date();
  await prisma.pipelineSyncCursor.upsert({
    where: { entityId },
    create: { entityId, lastWebhookAt: now },
    update: { lastWebhookAt: now },
  });
}

interface WorkflowRunPayload {
  id: number;
  name?: string | null;
  path?: string | null;
  display_title?: string | null;
  run_number?: number | null;
  event?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  html_url?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
  actor?: { login?: string | null } | null;
}

function readWorkflowRun(payload: Record<string, unknown>): WorkflowRunPayload | null {
  const wr = payload.workflow_run as WorkflowRunPayload | undefined;
  if (!wr || typeof wr !== "object") return null;
  if (typeof wr.id !== "number" || !Number.isFinite(wr.id)) return null;
  return wr;
}

export async function upsertWorkflowRun(payload: Record<string, unknown>): Promise<void> {
  const repo = readRepo(payload);
  const wr = readWorkflowRun(payload);
  if (!repo || !wr) return;

  const entityId = await findEntityIdByRepoId(repo.id);
  if (!entityId) {
    // Repo not registered as a catalog entity; silently drop.
    return;
  }

  const data = {
    entityId,
    workflowName: wr.name ?? wr.display_title ?? "(unnamed)",
    workflowPath: wr.path ?? "",
    runNumber: typeof wr.run_number === "number" ? wr.run_number : 0,
    event: wr.event ?? "unknown",
    status: wr.status ?? "queued",
    conclusion: wr.conclusion ?? null,
    headBranch: wr.head_branch ?? null,
    headSha: wr.head_sha ?? "",
    actorLogin: wr.actor?.login ?? null,
    htmlUrl: wr.html_url ?? "",
    runStartedAt: wr.run_started_at ? new Date(wr.run_started_at) : null,
    runUpdatedAt: wr.updated_at ? new Date(wr.updated_at) : null,
  };

  await prisma.workflowRun.upsert({
    where: { githubRunId: BigInt(wr.id) },
    create: { ...data, githubRunId: BigInt(wr.id) },
    update: data,
  });
  await touchWebhookCursor(entityId);
}

// `deployment` carries the canonical fields but no state; `deployment_status` flips state, so update state only when a status is present.

interface DeploymentPayload {
  id: number;
  environment?: string | null;
  ref?: string | null;
  sha?: string | null;
  description?: string | null;
  url?: string | null;
  creator?: { login?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface DeploymentStatusPayload {
  state?: string | null;
  description?: string | null;
  log_url?: string | null;
  environment_url?: string | null;
  target_url?: string | null;
  creator?: { login?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function readDeployment(payload: Record<string, unknown>): DeploymentPayload | null {
  const d = payload.deployment as DeploymentPayload | undefined;
  if (!d || typeof d !== "object") return null;
  if (typeof d.id !== "number" || !Number.isFinite(d.id)) return null;
  return d;
}

function readDeploymentStatus(payload: Record<string, unknown>): DeploymentStatusPayload | null {
  const ds = payload.deployment_status as DeploymentStatusPayload | undefined;
  if (!ds || typeof ds !== "object") return null;
  return ds;
}

function htmlUrlFromDeploymentUrl(apiUrl: string | null): string | null {
  if (!apiUrl) return null;
  // Rewrites the api.github.com deployments URL to its github.com html form.
  const m = /^https:\/\/api\.github\.com\/repos\/(.+?)\/deployments\/(\d+)/.exec(apiUrl);
  if (!m) return null;
  return `https://github.com/${m[1]}/deployments/${m[2]}`;
}

export async function upsertDeployment(payload: Record<string, unknown>): Promise<void> {
  const repo = readRepo(payload);
  const dep = readDeployment(payload);
  if (!repo || !dep) return;

  const entityId = await findEntityIdByRepoId(repo.id);
  if (!entityId) return;

  const status = readDeploymentStatus(payload);
  const htmlUrl = htmlUrlFromDeploymentUrl(dep.url ?? null);

  const create = {
    entityId,
    githubDeploymentId: BigInt(dep.id),
    environment: dep.environment ?? "unknown",
    ref: dep.ref ?? "",
    sha: dep.sha ?? "",
    state: status?.state ?? "pending",
    actorLogin: status?.creator?.login ?? dep.creator?.login ?? null,
    description: status?.description ?? dep.description ?? null,
    htmlUrl,
    logUrl: status?.log_url ?? status?.target_url ?? null,
    deployedAt: status?.updated_at
      ? new Date(status.updated_at)
      : dep.updated_at
        ? new Date(dep.updated_at)
        : null,
  };

  // Only overwrite fields the event carries so a bare `deployment` never clobbers an advanced state.
  const update: Partial<typeof create> = {
    environment: create.environment,
    ref: create.ref,
    sha: create.sha,
    actorLogin: create.actorLogin,
    description: create.description,
    htmlUrl: create.htmlUrl,
  };
  if (status) {
    update.state = create.state;
    update.logUrl = create.logUrl;
    update.deployedAt = create.deployedAt;
  }

  await prisma.deployment.upsert({
    where: { githubDeploymentId: BigInt(dep.id) },
    create,
    update,
  });
  await touchWebhookCursor(entityId);
}
