// Scheduled team jobs: request/maintainer-request expiration, hard delete, GitHub reconciliation.
import { prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend/contract";
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

export function teamRequestExpirationJob(): TeamJobDefinition {
  return {
    name: "teams.requestExpiration",
    schedule: "5 * * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const now = new Date();
      const due = await prisma.teamRequest.findMany({
        // Both states are an open negotiation the cron sweeps when its TTL elapses.
        where: {
          status: { in: ["pending", "awaiting_user_confirmation"] },
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          slug: true,
          requestedByUserId: true,
        },
        take: 500,
      });

      if (due.length === 0) {
        log.info({ count: 0 }, "No expired team requests");
        return;
      }

      let count = 0;
      for (const r of due) {
        if (signal.aborted) break;
        await prisma.$transaction(async (tx) => {
          await tx.teamRequest.update({
            where: { id: r.id },
            data: { status: "expired", reviewedAt: now },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: null,
              kind: "team.request.expired",
              targetKind: "teamRequest",
              targetId: r.id,
              payload: {
                requestId: r.id,
                slug: r.slug,
                requestedByUserId: r.requestedByUserId,
              },
            },
          });
          await notify(tx, {
            recipientUserId: r.requestedByUserId,
            kind: "team.request.expired",
            payload: { requestId: r.id, slug: r.slug },
          });
        });
        count++;
      }
      log.info({ count }, "Expired team requests");
    },
  };
}

export function maintainerRequestExpirationJob(): TeamJobDefinition {
  return {
    name: "teams.maintainerRequestExpiration",
    schedule: "10 * * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const now = new Date();
      const due = await prisma.maintainerRequest.findMany({
        where: { status: "pending", expiresAt: { lt: now } },
        select: {
          id: true,
          teamId: true,
          requestedByUserId: true,
          team: { select: { slug: true } },
        },
        take: 500,
      });
      if (due.length === 0) {
        log.info({ count: 0 }, "No expired maintainer requests");
        return;
      }
      let count = 0;
      for (const r of due) {
        if (signal.aborted) break;
        await prisma.$transaction(async (tx) => {
          await tx.maintainerRequest.update({
            where: { id: r.id },
            data: { status: "expired", reviewedAt: now },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: null,
              kind: "team.maintainer_request.expired",
              targetKind: "maintainerRequest",
              targetId: r.id,
              payload: {
                requestId: r.id,
                teamId: r.teamId,
                teamSlug: r.team.slug,
                requestedByUserId: r.requestedByUserId,
              },
            },
          });
          await notify(tx, {
            recipientUserId: r.requestedByUserId,
            kind: "team.maintainer_request.expired",
            payload: {
              requestId: r.id,
              teamId: r.teamId,
              teamSlug: r.team.slug,
            },
            teamId: r.teamId,
          });
        });
        count++;
      }
      log.info({ count }, "Expired maintainer requests");
    },
  };
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
  return [
    teamRequestExpirationJob(),
    maintainerRequestExpirationJob(),
    teamHardDeleteJob(),
    githubTeamReconciliationJob(),
  ];
}
