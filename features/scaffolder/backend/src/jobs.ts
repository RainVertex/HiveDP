import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@internal/db";
import { markStaleEntities } from "@feature/catalog-backend";
import { reconcileTemplateHashSnapshots, runDriftSweep } from "./services/drift";
import { discoverAndPersist, parseGithubUrl } from "./services/catalog-discovery";

// Scaffolder background jobs (drift sweeps, workspace GC, catalog discovery) for the apps/api scheduler.

// Interface mirrors apps/api/src/jobs/types.ts so this feature avoids an apps/api dependency.

export interface ScaffolderJobLogger {
  info(o: unknown, msg?: string): void;
}

export interface ScaffolderJobContext {
  log: ScaffolderJobLogger;
  signal: AbortSignal;
}

export interface ScaffolderJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: ScaffolderJobContext) => Promise<void>;
}

export interface ScaffolderJobsConfig {
  liveRepoRoot: string;
  systemUserId?: string;
  workspaceRoot?: string;
}

// One-shot startup hook (not a cron entry): reconciles snapshots and sweeps templates whose hash changed since boot.
export async function runBootDriftCheck(
  config: ScaffolderJobsConfig,
  log: ScaffolderJobLogger,
): Promise<void> {
  const { changed, unchanged } = await reconcileTemplateHashSnapshots();
  log.info({ changed, unchanged }, "Reconciled template hash snapshots");
  if (changed.length === 0) return;
  for (const templateId of changed) {
    const result = await runDriftSweep({
      liveRepoRoot: config.liveRepoRoot,
      templateId,
      systemUserId: config.systemUserId,
    });
    log.info(
      {
        templateId,
        opened: result.driftsOpened,
        coalesced: result.driftsCoalesced,
        scanned: result.bindingsScanned,
        errors: result.errors,
      },
      "Boot drift sweep complete",
    );
  }
}

// Daily backstop sweep: re-checks every active binding regardless of hash to catch missed events.
export function driftSweepJob(config: ScaffolderJobsConfig): ScaffolderJobDefinition {
  return {
    name: "scaffolder.driftSweep",
    schedule: "15 3 * * *",
    timeoutMs: 30 * 60 * 1000,
    handler: async ({ log }) => {
      const result = await runDriftSweep({
        liveRepoRoot: config.liveRepoRoot,
        systemUserId: config.systemUserId,
      });
      log.info(result, "Daily drift sweep complete");
    },
  };
}

// Hourly cleanup of leaked apply workspaces (cancelled/crashed runs); anything older than 24h is removed.
export function workspaceGcJob(config: ScaffolderJobsConfig): ScaffolderJobDefinition {
  return {
    name: "scaffolder.workspaceGc",
    schedule: "10 * * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: async ({ log }) => {
      const root = config.workspaceRoot ?? join(tmpdir(), "scaffolder");
      let removed = 0;
      let kept = 0;
      const now = Date.now();
      const horizon = 24 * 60 * 60 * 1000;
      let entries: string[];
      try {
        entries = await fs.readdir(root);
      } catch {
        log.info({ root }, "Workspace root absent; skipping");
        return;
      }
      for (const name of entries) {
        const dir = join(root, name);
        try {
          const stat = await fs.stat(dir);
          if (!stat.isDirectory()) continue;
          if (now - stat.mtimeMs >= horizon) {
            await fs.rm(dir, { recursive: true, force: true });
            removed++;
          } else {
            kept++;
          }
        } catch {
          // best effort, next sweep retries
        }
      }
      log.info({ root, removed, kept }, "Workspace GC complete");
    },
  };
}

// Daily sweep reconciling every CatalogEntity from its GitHub catalog-info.yaml; entities not seen get flagged stale.
export function catalogDiscoverySweepJob(): ScaffolderJobDefinition {
  return {
    name: "catalog.discoverySweep",
    schedule: "30 3 * * *",
    timeoutMs: 30 * 60 * 1000,
    handler: async ({ log }) => {
      const sweepStartedAt = new Date();
      const entities = await prisma.catalogEntity.findMany({
        where: { repoUrl: { not: null } },
        select: { id: true, repoUrl: true },
        orderBy: { lastSeenAt: "asc" },
      });
      const token = process.env.GITHUB_TOKEN;
      let scanned = 0;
      let created = 0;
      let updated = 0;
      let noop = 0;
      let errors = 0;
      const seenIds = new Set<string>();
      for (const entity of entities) {
        if (!entity.repoUrl) continue;
        const parsed = parseGithubUrl(entity.repoUrl);
        if (!parsed) continue;
        scanned++;
        try {
          const result = await discoverAndPersist({
            source: "github",
            target: `${parsed.owner}/${parsed.repo}`,
            token,
          });
          created += result.created;
          updated += result.updated;
          noop += result.noop;
          errors += result.errors.length;
          for (const id of result.entityIds) seenIds.add(id);
        } catch (err) {
          errors++;
          log.info(
            { repoUrl: entity.repoUrl, error: (err as Error).message },
            "catalog discovery failed for entity",
          );
        }
      }
      const flagged = await markStaleEntities(sweepStartedAt);
      log.info(
        { scanned, created, updated, noop, errors, flaggedStale: flagged },
        "Catalog discovery sweep complete",
      );
    },
  };
}

export function getScaffolderJobs(config: ScaffolderJobsConfig): ScaffolderJobDefinition[] {
  return [driftSweepJob(config), workspaceGcJob(config), catalogDiscoverySweepJob()];
}
