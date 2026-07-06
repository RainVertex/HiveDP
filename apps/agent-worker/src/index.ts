// Agent worker entrypoint: a separate process that drains chat-runtime (runtime="chat") agent tasks off
// the shared queue and runs each in-process with bounded concurrency. Kept out of the API so heavy,
// concurrent LLM tool loops never compete with HTTP request handling on the API event loop, and so one
// user's backlog never blocks another's (the claim is fair, per-owner capped).
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(__dirname, "../../../.env") });

import {
  runWorkerLoop,
  installWorkerFatalHandlers,
  registerBuiltinAgentTaskHandlers,
  reconcileStaleChatRuns,
  reconcileStaleChatTasks,
  type AgentJobContext,
  type AgentJobLogger,
} from "@feature/agents-backend";
import { registerProjectAgentTaskHandlers } from "@feature/projects-backend";
import { registerAllTools } from "@feature/agent-tools-backend";

const CONCURRENCY = Number(process.env.AGENT_WORKER_CONCURRENCY ?? 10);
const USER_CAP = Number(process.env.AGENT_WORKER_USER_CAP ?? 3);
const IDLE_MS = Number(process.env.AGENT_WORKER_IDLE_MS ?? 1000);

const log: AgentJobLogger = {
  info: (o, msg) => console.log(`[agent-worker] ${msg ?? ""}`, o),
  error: (o, msg) => console.error(`[agent-worker] ${msg ?? ""}`, o),
};

async function main(): Promise<void> {
  installWorkerFatalHandlers(log);
  // The tool registry is process-local, without this skills resolve to zero tools in this worker.
  registerAllTools();
  registerBuiltinAgentTaskHandlers();
  registerProjectAgentTaskHandlers();

  const staleRuns = await reconcileStaleChatRuns();
  if (staleRuns.runs > 0) log.info(staleRuns, "Marked orphaned chat runs as failed");
  const staleTasks = await reconcileStaleChatTasks();
  if (staleTasks.released > 0 || staleTasks.deadLettered > 0)
    log.info(staleTasks, "Reconciled orphaned chat tasks");

  const controller = new AbortController();
  const ctx: AgentJobContext = { log, signal: controller.signal };

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "Agent worker shutting down");
    controller.abort();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log.info({ concurrency: CONCURRENCY, userCap: USER_CAP }, "Agent worker started");
  await runWorkerLoop(ctx, {
    runtimes: ["chat"],
    concurrency: CONCURRENCY,
    userCap: USER_CAP,
    idleMs: IDLE_MS,
  });
  log.info({}, "Agent worker stopped");
  process.exit(0);
}

main().catch((err) => {
  log.error?.({ err }, "Agent worker bootstrap failed");
  process.exit(1);
});
