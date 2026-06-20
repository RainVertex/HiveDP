// Scheduled agent jobs: the generic AgentTask queue drainer plus the model pricing sync.
import { runAgent } from "./executor";
import { syncModelPricing } from "./services/pricing";
import {
  claimDueTasks,
  settleTask,
  deferTask,
  failTask as failAgentTask,
} from "./services/agentTasks";
import { getAgentTaskHandler, defaultInterpret } from "./services/agentTaskHandlers";

export interface AgentJobLogger {
  info(o: unknown, msg?: string): void;
  error?(o: unknown, msg?: string): void;
}

export interface AgentJobContext {
  log: AgentJobLogger;
  signal: AbortSignal;
}

export interface AgentJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: AgentJobContext) => Promise<void>;
}

// Default re-queue delay when a handler's precheck defers a task (matches the old enricher cadence).
const DEFER_MS = 10 * 60_000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Drains up to maxTasks due AgentTask rows: each runs its agent, then the kind's handler
// interprets the result into a terminal, retry, or (via precheck) deferred outcome.
async function drainAgentTasks(ctx: AgentJobContext, maxTasks: number): Promise<void> {
  const { log, signal } = ctx;
  const tasks = await claimDueTasks(maxTasks);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let deferred = 0;

  for (const task of tasks) {
    if (signal.aborted) break;
    const handler = getAgentTaskHandler(task.kind);
    if (!handler) {
      skipped++;
      await settleTask(task.id, {
        status: "skipped",
        lastError: `No handler registered for kind "${task.kind}"`,
      });
      log.info({ taskId: task.id, kind: task.kind }, "Skipped agent task: no handler");
      continue;
    }

    const payload = asRecord(task.payload);

    if (handler.precheck) {
      const pre = await handler.precheck(payload);
      if (!pre.ready) {
        deferred++;
        await deferTask(task.id, task.attempts, pre.delayMs ?? DEFER_MS, pre.reason);
        log.info({ taskId: task.id, kind: task.kind, reason: pre.reason }, "Deferred agent task");
        continue;
      }
    }

    try {
      const input = await handler.buildRunInput(payload);
      const opts = (await handler.runOptions?.(payload)) ?? {};
      const result = await runAgent(task.agentId, input, {
        ...opts,
        signal,
        trigger: opts.trigger ?? task.kind,
      });
      const outcome = handler.interpret
        ? await handler.interpret({ payload, result })
        : defaultInterpret(result);

      if (outcome.status === "retry") {
        failed++;
        await failAgentTask(
          task.id,
          task.attempts,
          task.maxAttempts,
          outcome.lastError ?? result.error ?? "agent run failed",
          result.agentRunId,
        );
      } else {
        if (outcome.status === "done") done++;
        else skipped++;
        await settleTask(task.id, {
          status: outcome.status,
          runId: result.agentRunId,
          lastError: outcome.lastError ?? null,
          payload: outcome.payloadPatch ? { ...payload, ...outcome.payloadPatch } : undefined,
        });
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.info({ taskId: task.id, error: message }, "Agent task run threw");
      await failAgentTask(task.id, task.attempts, task.maxAttempts, message);
    }
  }

  log.info(
    { claimed: tasks.length, done, skipped, failed, deferred },
    "Agent task queue drain complete",
  );
}

// Near-real-time drain of the generic agent task queue.
export function agentTaskQueueJob(): AgentJobDefinition {
  return {
    name: "agents.taskQueue",
    schedule: "*/2 * * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: (ctx) => drainAgentTasks(ctx, 25),
  };
}

// Daily refresh of model rates from OpenRouter so costPer1k* is not hand-maintained.
export function modelPricingSyncJob(): AgentJobDefinition {
  return {
    name: "agents.modelPricingSync",
    schedule: "0 5 * * *",
    timeoutMs: 60_000,
    handler: async ({ log, signal }) => {
      const result = await syncModelPricing({ signal });
      log.info(result, "Model pricing sync complete");
    },
  };
}

export function getAgentJobs(): AgentJobDefinition[] {
  return [agentTaskQueueJob(), modelPricingSyncJob()];
}
