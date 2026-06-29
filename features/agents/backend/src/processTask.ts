import type { AgentTask } from "@internal/db";
import { runAgent } from "./executor";
import { settleTask, deferTask, failTask } from "./services/agentTasks";
import { getAgentTaskHandler, defaultInterpret } from "./services/agentTaskHandlers";
import { isModelOverDailyCap, msUntilDailyCapReset } from "./services/dailyCap";
import type { AgentJobContext } from "./jobTypes";

// Runs one claimed AgentTask end to end: the kind's handler builds the run input, runAgent executes the
// agent, then the handler interprets the result into a terminal, retry, or deferred outcome. Self
// contained so the worker pool can run many of these concurrently.

const DEFER_MS = 10 * 60_000;

export type ProcessTaskStatus = "done" | "skipped" | "failed" | "deferred";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function processAgentTask(
  task: AgentTask,
  ctx: AgentJobContext,
): Promise<ProcessTaskStatus> {
  const { log, signal } = ctx;
  const handler = getAgentTaskHandler(task.kind);
  if (!handler) {
    await settleTask(task.id, {
      status: "skipped",
      lastError: `No handler registered for kind "${task.kind}"`,
    });
    log.info({ taskId: task.id, kind: task.kind }, "Skipped agent task: no handler");
    return "skipped";
  }

  const payload = asRecord(task.payload);

  if (handler.precheck) {
    const pre = await handler.precheck(payload);
    if (!pre.ready) {
      await deferTask(task.id, task.attempts, pre.delayMs ?? DEFER_MS, pre.reason);
      log.info({ taskId: task.id, kind: task.kind, reason: pre.reason }, "Deferred agent task");
      return "deferred";
    }
  }

  // Defer work on a model that is over its daily token cap until the UTC window resets.
  if (await isModelOverDailyCap(task.agentId)) {
    await deferTask(task.id, task.attempts, msUntilDailyCapReset(), "daily token cap reached");
    log.info({ taskId: task.id, kind: task.kind }, "Deferred agent task: daily token cap reached");
    return "deferred";
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
      await failTask(
        task.id,
        task.attempts,
        task.maxAttempts,
        outcome.lastError ?? result.error ?? "agent run failed",
        result.agentRunId,
      );
      return "failed";
    }
    await settleTask(task.id, {
      status: outcome.status,
      runId: result.agentRunId,
      lastError: outcome.lastError ?? null,
      payload: outcome.payloadPatch ? { ...payload, ...outcome.payloadPatch } : undefined,
    });
    return outcome.status === "done" ? "done" : "skipped";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info({ taskId: task.id, error: message }, "Agent task run threw");
    await failTask(task.id, task.attempts, task.maxAttempts, message);
    return "failed";
  }
}
