// Scheduled team jobs: hard delete of soft-deleted teams and GitHub reconciliation.
import { prisma } from "@internal/db";
import { expirePendingMemberships, runReconciliation } from "@feature/catalog-backend/contract";

export interface TeamJobLogger {
  info(o: unknown, msg?: string): void;
}

export interface TeamJobContext {
  log: TeamJobLogger;
  signal: AbortSignal;
}

export interface TeamJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: TeamJobContext) => Promise<void>;
}

/** Daily: hard-delete soft-deleted Teams older than 30 days. */
export function teamHardDeleteJob(): TeamJobDefinition {
  return {
    name: "teams.hardDelete",
    schedule: "30 4 * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: async ({ log }) => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const due = await prisma.team.findMany({
        where: { deletedAt: { lt: cutoff } },
        select: { id: true, slug: true },
        take: 200,
      });

      let count = 0;
      for (const t of due) {
        await prisma.$transaction(async (tx) => {
          await tx.team.delete({ where: { id: t.id } });
          await tx.auditEvent.create({
            data: {
              kind: "team.hard_deleted",
              targetKind: "team",
              targetId: t.id,
              payload: { teamId: t.id, slug: t.slug },
            },
          });
        });
        count++;
      }
      log.info({ count }, "Hard-deleted soft-deleted teams");
    },
  };
}

/** Weekly: differential GitHub team reconciliation. */
export function githubTeamReconciliationJob(): TeamJobDefinition {
  return {
    name: "teams.githubReconciliation",
    schedule: "0 4 * * 0",
    timeoutMs: 30 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const integrations = await prisma.integration.findMany({
        where: { kind: "github", enabled: true },
        select: { id: true, config: true },
      });

      let runs = 0;
      let failures = 0;
      let skipped = 0;
      for (const integ of integrations) {
        if (signal.aborted) break;
        const cfg =
          integ.config && typeof integ.config === "object" && !Array.isArray(integ.config)
            ? (integ.config as Record<string, unknown>)
            : {};
        const installationId = Number(cfg.installationId);
        if (!Number.isFinite(installationId)) {
          skipped++;
          continue;
        }
        try {
          const result = await runReconciliation(installationId, "cron");
          runs++;
          log.info(
            {
              integrationId: integ.id,
              installationId,
              runId: result.runId,
              teamsCreated: result.teamsCreated,
              teamsUpdated: result.teamsUpdated,
              teamsDeleted: result.teamsDeleted,
              membersAdded: result.membersAdded,
              membersRemoved: result.membersRemoved,
              pendingQueued: result.pendingQueued,
              skippedReason: result.skippedReason,
            },
            "Reconciled GitHub installation",
          );
        } catch (err) {
          failures++;
          log.info(
            { integrationId: integ.id, installationId, error: (err as Error).message },
            "Reconciliation failed",
          );
        }
      }

      const expired = await expirePendingMemberships();
      log.info(
        { runs, failures, skipped, expiredPendingMemberships: expired.deleted },
        "Weekly GitHub team reconciliation complete",
      );
    },
  };
}

export function getTeamJobs(): TeamJobDefinition[] {
  return [teamHardDeleteJob(), githubTeamReconciliationJob()];
}
