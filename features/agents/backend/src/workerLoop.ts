import pLimit from "p-limit";
import { claimOneFair } from "./services/agentTasks";
import { processAgentTask } from "./processTask";
import type { AgentJobContext, AgentJobLogger } from "./jobTypes";

// Continuous pull pool that drains the agent task queue with bounded async concurrency. It keeps up to
// `concurrency` runs in flight, claiming one task fairly (per-owner cap) whenever a slot frees, so a long
// run never blocks the others and no single owner monopolizes the pool. The per-row atomic claim makes
// running several instances of this loop against one database safe.

export interface WorkerLoopOptions {
  runtimes: string[];
  concurrency: number;
  userCap: number;
  // Poll interval when the queue had nothing claimable; short tick when it did so the pool refills fast.
  idleMs?: number;
  tickMs?: number;
  // Max time to wait for in-flight runs to settle after an abort before returning.
  drainTimeoutMs?: number;
}

const DEFAULT_IDLE_MS = 1000;
const DEFAULT_TICK_MS = 50;
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWorkerLoop(ctx: AgentJobContext, opts: WorkerLoopOptions): Promise<void> {
  const { runtimes, concurrency, userCap } = opts;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const drainTimeoutMs = opts.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const { log, signal } = ctx;
  const limit = pLimit(concurrency);
  const inFlight = (): number => limit.activeCount + limit.pendingCount;

  while (!signal.aborted) {
    let claimedAny = false;
    while (!signal.aborted && inFlight() < concurrency) {
      const task = await claimOneFair({ runtimes, userCap });
      if (!task) break;
      claimedAny = true;
      void limit(() => processAgentTask(task, ctx)).catch((err) => {
        log.error?.({ err, taskId: task.id }, "Agent task crashed in worker pool");
      });
    }
    await sleep(claimedAny ? tickMs : idleMs, signal);
  }

  // Aborted: stop claiming and let the in-flight runs settle. They observe the same aborted signal
  // through runAgent, so they wind down quickly. Bounded so shutdown cannot hang forever.
  const deadline = Date.now() + drainTimeoutMs;
  while (inFlight() > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (inFlight() > 0)
    log.error?.({ inFlight: inFlight() }, "Worker drain timed out with runs in flight");
}

// Last-resort handlers so a fatal (OOM, native crash, unhandled rejection) is logged before the process
// dies. Tasks left "running" are released or dead-lettered by the next boot's attempt-aware reconcile,
// so a task that repeatedly crashes the worker is eventually retired instead of looping forever.
export function installWorkerFatalHandlers(log: AgentJobLogger): void {
  process.on("uncaughtException", (err) => {
    log.error?.({ err }, "Uncaught exception in worker; exiting");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error?.({ reason }, "Unhandled rejection in worker; exiting");
    process.exit(1);
  });
}
