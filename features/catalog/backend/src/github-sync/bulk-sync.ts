// Org-level repo sync from a GitHub App installation: discovers catalog-info.yaml, registers entities, enqueues onboarding for stubs.
import { prisma } from "@internal/db";
import { GitHubAppNotConfiguredError, octokitForInstallation } from "@feature/integrations-backend";
import type { Octokit as OctokitClient } from "octokit";
import { CATALOG_INFO_FILE_NAMES, parseCatalogInfo } from "../discovery/parse";
import { registerCatalogEntity, type RegisterCatalogEntityInput } from "../service";
import { runReconciliation, type ReconciliationResult } from "./team-sync";
import { provisionProjectsForInstallation } from "@feature/projects-backend";

export interface SyncRepoResult {
  fullName: string;
  githubRepoId: number;
  entityId: string;
  action: "created" | "updated" | "noop";
  hadCatalogInfo: boolean;
  parseError: string | null;
}

export interface SyncInstallationResult {
  installationId: number;
  reposExamined: number;
  created: number;
  updated: number;
  noop: number;
  withCatalogInfo: number;
  needsOnboarding: number;
  errors: Array<{ fullName: string; reason: string }>;
  // Null if the installation isn't on an org.
  teamSync: ReconciliationResult | null;
  // Null if the provisioning step failed.
  projectsProvisioned: { created: number; updated: number; archived: number } | null;
  startedAt: Date;
  finishedAt: Date;
}

interface RepoSummary {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  archived: boolean;
  topics?: string[];
}

/** Sync every repo accessible to the installation. */
export async function syncInstallation(installationId: number): Promise<SyncInstallationResult> {
  const startedAt = new Date();
  const result: SyncInstallationResult = {
    installationId,
    reposExamined: 0,
    created: 0,
    updated: 0,
    noop: 0,
    withCatalogInfo: 0,
    needsOnboarding: 0,
    errors: [],
    teamSync: null,
    projectsProvisioned: null,
    startedAt,
    finishedAt: startedAt,
  };

  let octo: OctokitClient;
  try {
    octo = await octokitForInstallation(installationId);
  } catch (err) {
    if (err instanceof GitHubAppNotConfiguredError) {
      throw err;
    }
    throw err;
  }

  const repos = (await octo.paginate(octo.rest.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  })) as RepoSummary[];

  for (const repo of repos) {
    if (repo.archived) continue;
    result.reposExamined++;
    try {
      const single = await syncRepo(octo, repo, installationId);
      if (single.action === "created") result.created++;
      else if (single.action === "updated") result.updated++;
      else result.noop++;
      if (single.hadCatalogInfo) result.withCatalogInfo++;
      else result.needsOnboarding++;
    } catch (err) {
      result.errors.push({
        fullName: repo.full_name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Runs after repos so owner-team references can resolve to imported teams on later passes.
  try {
    result.teamSync = await runReconciliation(installationId, "manual");
  } catch (err) {
    result.errors.push({
      fullName: "<team-sync>",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const provisioning = await provisionProjectsForInstallation(installationId, "bulk");
    result.projectsProvisioned = provisioning;
  } catch (err) {
    result.errors.push({
      fullName: "<projects-provision>",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  result.finishedAt = new Date();
  await stampSyncedAt(installationId, result.finishedAt);
  return result;
}

/** Sync a single repo. */
export async function syncRepo(
  octo: OctokitClient,
  repo: RepoSummary,
  installationId: number,
): Promise<SyncRepoResult> {
  const [owner, name] = repo.full_name.split("/");
  if (!owner || !name) {
    throw new Error(`unexpected repo full_name "${repo.full_name}"`);
  }

  const fetched = await fetchCatalogInfo(octo, owner, name, repo.default_branch);

  let registerInput: RegisterCatalogEntityInput;
  let yamlSpec: unknown = null;
  let needsOnboarding: boolean;
  let parseError: string | null = null;

  if (fetched.kind === "ok") {
    // Force repoUrl to canonical html_url so links work even when the yaml omitted it.
    registerInput = { ...fetched.input, repoUrl: repo.html_url };
    yamlSpec = fetched.yamlSpec;
    needsOnboarding = false;
  } else {
    if (fetched.kind === "error") parseError = fetched.reason;
    // Stub entity from repo metadata; the Catalog Agent later refines kind via heuristics.
    registerInput = {
      kind: "service",
      name: repo.name,
      description: repo.description,
      ownerTeamIds: [],
      repoUrl: repo.html_url,
      tags: repo.topics ?? [],
      yamlSpec: null,
    };
    needsOnboarding = true;
  }

  const result = await registerCatalogEntity(
    {
      ...registerInput,
      yamlSpec: yamlSpec === null ? null : (yamlSpec as never),
    },
    {
      source: "discovery",
      sourceRef: `github-app:${installationId}/${repo.full_name}`,
      needsOnboarding,
      installationId,
      githubRepoId: repo.id,
    },
  );

  const ownerCount = registerInput.ownerTeamIds?.length ?? 0;
  if (needsOnboarding || ownerCount === 0) {
    await enqueueResolveOwnership(result.entityId);
  }

  return {
    fullName: repo.full_name,
    githubRepoId: repo.id,
    entityId: result.entityId,
    action: result.action,
    hadCatalogInfo: fetched.kind === "ok",
    parseError,
  };
}

type FetchResult =
  | { kind: "ok"; input: RegisterCatalogEntityInput; yamlSpec: unknown }
  | { kind: "missing" }
  | { kind: "error"; reason: string };

async function fetchCatalogInfo(
  octo: OctokitClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<FetchResult> {
  for (const path of CATALOG_INFO_FILE_NAMES) {
    let raw: string;
    try {
      const res = await octo.rest.repos.getContent({ owner, repo, path, ref });
      const data = res.data as { type?: string; encoding?: string; content?: string };
      if (data.type !== "file" || data.encoding !== "base64" || !data.content) continue;
      raw = Buffer.from(data.content, "base64").toString("utf8");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) continue;
      return { kind: "error", reason: (err as Error).message };
    }
    const parsed = parseCatalogInfo(path, raw);
    if (parsed.kind === "ok") {
      return { kind: "ok", input: parsed.input, yamlSpec: parsed.yamlSpec };
    }
    return { kind: "error", reason: parsed.reason };
  }
  return { kind: "missing" };
}

async function enqueueResolveOwnership(entityId: string): Promise<void> {
  // Idempotent: skip if a pending/running task already exists so re-runs don't pile up duplicates.
  const existing = await prisma.catalogAgentTask.findFirst({
    where: {
      entityId,
      type: "resolve_ownership",
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.catalogAgentTask.create({
    data: { entityId, type: "resolve_ownership", status: "pending" },
  });
}

/** Sync a repo when only its owner/name is known. */
export async function syncRepoByName(
  octo: OctokitClient,
  owner: string,
  name: string,
  installationId: number,
): Promise<SyncRepoResult | null> {
  let res;
  try {
    res = await octo.rest.repos.get({ owner, repo: name });
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
  const data = res.data as RepoSummary & { topics?: string[] };
  return syncRepo(
    octo,
    {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      html_url: data.html_url,
      default_branch: data.default_branch,
      archived: data.archived,
      topics: data.topics ?? [],
    },
    installationId,
  );
}

/** Mark every entity tied to an installation as stale. */
export async function staleEntitiesForInstallation(
  installationId: number,
  staleSince: Date = new Date(),
): Promise<number> {
  const result = await prisma.catalogEntity.updateMany({
    where: { installationId, staleSince: null },
    data: { staleSince },
  });
  return result.count;
}

/** Stale a single entity by its GitHub repo id. */
export async function staleEntityByGithubRepoId(
  githubRepoId: number,
  staleSince: Date = new Date(),
): Promise<string | null> {
  const existing = await prisma.catalogEntity.findUnique({
    where: { githubRepoId },
    select: { id: true, staleSince: true },
  });
  if (!existing) return null;
  if (existing.staleSince !== null) return existing.id;
  await prisma.catalogEntity.update({
    where: { id: existing.id },
    data: { staleSince },
  });
  return existing.id;
}

async function stampSyncedAt(installationId: number, syncedAt: Date): Promise<void> {
  // installationId lives in the JSON config field, so we scan kind=github rows and match in JS.
  const rows = await prisma.integration.findMany({
    where: { kind: "github" },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const cfg =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : null;
    if (cfg && cfg.installationId === installationId) {
      await prisma.integration.update({
        where: { id: row.id },
        data: {
          config: { ...cfg, syncedAt: syncedAt.toISOString() },
        },
      });
      return;
    }
  }
}
