// API entrypoint: loads env, boots the HTTP server, runs boot-time reconciliation, wires graceful shutdown.
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(__dirname, "../../../.env") });

import {
  runBootDriftCheck,
  seedDefaultTemplates,
  seedTemplateAcls,
} from "@feature/scaffolder-backend";
import {
  provisionProjectsForInstallation,
  registerProjectAgentTaskHandlers,
} from "@feature/projects-backend";
import {
  reconcileStaleAgentRuns,
  reconcileStaleAgentTasks,
  registerBuiltinAgentTaskHandlers,
} from "@feature/agents-backend";
import { runReconciliation } from "@feature/catalog-backend";
import { prisma } from "@internal/db";
import { createServer } from "./createServer";
import { logger } from "./logger/logger";
import { loadEnv, type AppEnv } from "./config/env";
import {
  abortAll,
  cancelOrphanedRuns,
  registerAllJobs,
  startScheduler,
  stopScheduler,
  waitForInFlight,
} from "./jobs";

let env: AppEnv;
try {
  env = loadEnv();
} catch (err) {
  logger.fatal({ err }, "Environment validation failed; refusing to start");
  process.exit(1);
}

async function bootstrap() {
  const app = createServer();

  const orphans = await cancelOrphanedRuns();
  if (orphans > 0) logger.warn({ orphans }, "Marked orphaned job runs as cancelled");

  const staleRuns = await reconcileStaleAgentRuns();
  if (staleRuns.runs > 0) logger.warn(staleRuns, "Marked orphaned agent runs as failed");

  const staleTasks = await reconcileStaleAgentTasks();
  if (staleTasks > 0)
    logger.warn({ tasks: staleTasks }, "Released orphaned agent tasks to the queue");

  // Features register their agent-task handlers before the scheduler can drain the queue.
  registerBuiltinAgentTaskHandlers();
  registerProjectAgentTaskHandlers();

  registerAllJobs();
  startScheduler();

  // Best-effort, failure here must not block the API coming up.
  runBootDriftCheck({}, logger.child({ jobName: "scaffolder.bootDriftCheck" })).catch((err) => {
    logger.error({ err }, "Boot drift check failed");
  });

  seedDefaultTemplates()
    .then(({ created, skipped }) => {
      if (created > 0) logger.info({ created, skipped }, "Seeded default scaffolder templates");
    })
    .catch((err) => {
      logger.error({ err }, "Default template seeding failed");
    })
    .finally(() => {
      seedTemplateAcls()
        .then(({ created, skipped }) => {
          if (created > 0) logger.info({ created, skipped }, "Seeded default TemplateAcl rows");
        })
        .catch((err) => {
          logger.error({ err }, "TemplateAcl seeding failed");
        });
    });

  // Idempotent backfill that catches repos which missed a webhook or predate auto-provisioning.
  prisma.integration
    .findMany({ where: { kind: "github", enabled: true }, select: { config: true } })
    .then(async (integrations) => {
      for (const i of integrations) {
        const cfg =
          i.config && typeof i.config === "object" && !Array.isArray(i.config)
            ? (i.config as Record<string, unknown>)
            : {};
        const installationId = Number(cfg.installationId);
        if (!Number.isFinite(installationId)) continue;
        try {
          // Re-sync teams and team-repo grants first so any team-role change missed while
          // offline (or undeliverable to localhost in dev) lands before projects re-provision.
          const run = await runReconciliation(installationId, "boot");
          if (!run.ok) {
            logger.warn(
              { installationId, skippedReason: run.skippedReason, errors: run.errors },
              "Boot reconciliation did not complete cleanly",
            );
          }
          const summary = await provisionProjectsForInstallation(installationId, "boot");
          logger.info(
            { installationId, grantsUpserted: run.grantsUpserted, ...summary },
            "PM auto-provision (boot) complete",
          );
        } catch (err) {
          logger.error({ err, installationId }, "PM auto-provision (boot) failed");
        }
      }
    })
    .catch((err) => {
      logger.error({ err }, "Boot-time PM provisioning bootstrap failed");
    });

  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv },
      `Backend listening on http://localhost:${env.port}`,
    );
  });

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received");
    stopScheduler();
    abortAll();
    await waitForInFlight(20_000);
    server.close(() => {
      logger.info("HTTP server closed; exiting");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Shutdown timeout exceeded; forcing exit");
      process.exit(1);
    }, 30_000).unref();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Bootstrap failed");
  process.exit(1);
});
