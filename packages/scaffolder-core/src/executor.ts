// Runs a built plan's steps sequentially, recording compensations and rolling back on failure.
import type { ActionRegistry } from "./actions/registry";
import type { ActionLogger, Compensation, SecretAccessor, WriteCtx } from "./actions/types";
import { replayFsCompensation } from "./actions/fs";
import type { Plan, TaskStatus } from "./types";
import type { PlanCtx } from "./plan-ctx";
import type { Redactor } from "./redact";
import { containsToken, resolveTokens, type StepTemplateContext } from "./tokens";

export type StepEvent =
  | { kind: "task.started"; taskId: string }
  | { kind: "step.started"; taskId: string; stepId: string; action: string }
  | {
      kind: "step.finished";
      taskId: string;
      stepId: string;
      status: "succeeded" | "failed" | "cancelled";
      output?: unknown;
      error?: string;
    }
  | { kind: "log"; taskId: string; stepId?: string; level: "info" | "warn" | "error"; body: string }
  | {
      kind: "task.finished";
      taskId: string;
      status: TaskStatus;
      output?: unknown;
      error?: string;
    };

export interface ExecuteInput {
  taskId: string;
  plan: Plan;
  resolvedSteps: Array<{ stepId: string; action: string; input: unknown; deferred?: boolean }>;
  actions: ActionRegistry;
  planCtx: PlanCtx;
  // jq context persisted at plan time, step outputs are layered on top during the run.
  templateContext?: StepTemplateContext;
  workspacePath: string;
  repoRoot: string;
  signal: AbortSignal;
  secrets: SecretAccessor;
  redactor: Redactor;
  dryRun: boolean;
  emit: (event: StepEvent) => void;
}

export interface ExecuteResult {
  status: TaskStatus;
  output: Record<string, unknown>;
  error?: string;
  // Compensations recorded for steps that ran successfully, in apply order.
  compensations: Array<{ stepId: string; compensation: Compensation }>;
  rolledBack: boolean;
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

function makeStepLogger(
  emit: ExecuteInput["emit"],
  taskId: string,
  stepId: string,
  redactor: Redactor,
): ActionLogger {
  const send = (level: "info" | "warn" | "error", body: string) =>
    emit({ kind: "log", taskId, stepId, level, body: redactor.redact(body) });
  return {
    info: (m) => send("info", m),
    warn: (m) => send("warn", m),
    error: (m) => send("error", m),
  };
}

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const {
    taskId,
    resolvedSteps,
    actions,
    planCtx,
    templateContext,
    workspacePath,
    repoRoot,
    signal,
    secrets,
    redactor,
    dryRun,
    emit,
  } = input;

  emit({ kind: "task.started", taskId });

  const stepOutputs: Record<string, unknown> = {};
  const stepsJqState: Record<string, { outputs: unknown }> = {};
  const compensations: ExecuteResult["compensations"] = [];

  const buildWriteCtx = (logger: ActionLogger): WriteCtx => ({
    ...planCtx,
    workspacePath,
    repoRoot,
    logger,
    signal,
    secrets,
    dryRun,
  });

  let failure: { stepId: string; error: Error } | null = null;
  let cancelled = false;

  for (const step of resolvedSteps) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }
    const action = actions.require(step.action);
    emit({ kind: "step.started", taskId, stepId: step.stepId, action: action.id });
    const logger = makeStepLogger(emit, taskId, step.stepId, redactor);
    try {
      let stepInput = step.input;
      if (step.deferred || containsToken(stepInput)) {
        const ctx: StepTemplateContext = {
          inputs: templateContext?.inputs ?? {},
          user: templateContext?.user ?? null,
          entity: templateContext?.entity ?? null,
          operation: templateContext?.operation ?? "create",
          steps: stepsJqState,
        };
        stepInput = action.schema.parse(await resolveTokens(stepInput, ctx, "apply"));
      }
      const result = await action.apply(stepInput, buildWriteCtx(logger));
      stepOutputs[step.stepId] = result.output;
      stepsJqState[step.stepId] = { outputs: result.output };
      if (result.compensation && !dryRun) {
        compensations.push({ stepId: step.stepId, compensation: result.compensation });
      }
      emit({
        kind: "step.finished",
        taskId,
        stepId: step.stepId,
        status: "succeeded",
        output: result.output,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message = redactor.redact(error.message);
      emit({
        kind: "step.finished",
        taskId,
        stepId: step.stepId,
        status: signal.aborted ? "cancelled" : "failed",
        error: message,
      });
      if (signal.aborted) {
        cancelled = true;
      } else {
        failure = { stepId: step.stepId, error };
      }
      break;
    }
  }

  let rolledBack = false;
  if ((failure || cancelled) && compensations.length > 0 && !dryRun) {
    // Reverse order; irreversible mutations are never admitted without an approval token.
    for (let i = compensations.length - 1; i >= 0; i--) {
      const { compensation } = compensations[i]!;
      try {
        await replayFsCompensation(compensation as { kind: string; [k: string]: unknown }, {
          workspacePath,
          repoRoot,
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        emit({
          kind: "log",
          taskId,
          level: "error",
          body: redactor.redact(
            `rollback failed for compensation ${compensation.kind}: ${e.message}`,
          ),
        });
      }
    }
    rolledBack = true;
  }

  const status: TaskStatus = cancelled
    ? rolledBack
      ? "rolled_back"
      : "cancelled"
    : failure
      ? rolledBack
        ? "rolled_back"
        : "failed"
      : "succeeded";

  const result: ExecuteResult = {
    status,
    output: stepOutputs,
    compensations,
    rolledBack,
    ...(failure ? { error: redactor.redact(failure.error.message) } : {}),
    ...(cancelled && !failure ? { error: "cancelled" } : {}),
  };

  emit({
    kind: "task.finished",
    taskId,
    status,
    output: stepOutputs,
    ...(result.error ? { error: result.error } : {}),
  });
  return result;
}

export { CancelledError };
