// Coding worker entrypoint: a separate process that drains only coding-runtime (runtime="code") agent
// tasks off the shared queue and runs each in an ephemeral Docker sandbox. Kept out of the API process
// so a multi-minute coding run never blocks chat execution, and so untrusted shell/git runs only where
// Docker and the egress-allowlist network are configured.
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(__dirname, "../../../.env") });

// This process is the coding execution boundary; runCodingAgent refuses to spawn Docker unless set.
process.env.CODING_RUNTIME_ENABLED = "1";

import {
  runWorkerLoop,
  installWorkerFatalHandlers,
  registerBuiltinAgentTaskHandlers,
  reconcileStaleCodingRuns,
  reconcileStaleCodingTasks,
  initContainerPool,
  shutdownContainerPool,
  type AgentJobContext,
  type AgentJobLogger,
} from "@feature/agents-backend";
import { registerProjectAgentTaskHandlers } from "@feature/projects-backend";

const CONCURRENCY = Number(process.env.CODING_WORKER_CONCURRENCY ?? 3);
const USER_CAP = Number(process.env.CODING_WORKER_USER_CAP ?? 2);

const log: AgentJobLogger = {
  info: (o, msg) => console.log(`[coding-worker] ${msg ?? ""}`, o),
  error: (o, msg) => console.error(`[coding-worker] ${msg ?? ""}`, o),
};

async function main(): Promise<void> {
  if (!process.env.CODING_RUNNER_IMAGE) {
    log.error?.(
      {},
      "CODING_RUNNER_IMAGE is not set; coding runs will fail until it is configured.",
    );
  }

  installWorkerFatalHandlers(log);
  registerBuiltinAgentTaskHandlers();
  registerProjectAgentTaskHandlers();

  const staleRuns = await reconcileStaleCodingRuns();
  if (staleRuns.runs > 0) log.info(staleRuns, "Marked orphaned coding runs as failed");
  const staleTasks = await reconcileStaleCodingTasks();
  if (staleTasks.released > 0 || staleTasks.deadLettered > 0)
    log.info(staleTasks, "Reconciled orphaned coding tasks");

  const controller = new AbortController();
  const ctx: AgentJobContext = { log, signal: controller.signal };

  // Pre-warm the sandbox container pool so the first coding run does not pay full container startup.
  // Skip when no image is configured so a dev box without it does not spin a pointless reaper.
  if (process.env.CODING_RUNNER_IMAGE) initContainerPool();

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "Coding worker shutting down");
    controller.abort();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log.info({ concurrency: CONCURRENCY, userCap: USER_CAP }, "Coding worker started");
  await runWorkerLoop(ctx, { runtimes: ["code"], concurrency: CONCURRENCY, userCap: USER_CAP });
  shutdownContainerPool();
  log.info({}, "Coding worker stopped");
  process.exit(0);
}

main().catch((err) => {
  log.error?.({ err }, "Coding worker bootstrap failed");
  process.exit(1);
});
