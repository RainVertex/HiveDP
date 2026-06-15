import { randomUUID } from "node:crypto";
import { prisma } from "@internal/db";
import {
  acquireSandbox,
  createRedactor,
  createSecretAccessor,
  execute,
  type ActionRegistry,
  type Plan,
  type StepEvent,
  type Compensation,
  type StepTemplateContext,
  type TaskStatus,
} from "@internal/scaffolder-core";
import type { PlanCtx } from "@internal/scaffolder-core";
import { acquireTargetLock, ensurePlanFresh, StalePlanError } from "./locks";
import { taskEventBus } from "./events";

// Orchestrates applying a scaffolder plan: gates, lock, sandbox, execute, persist.
export interface ApplyInput {
  plan: Plan;
  resolvedSteps: Array<{ stepId: string; action: string; input: unknown; deferred?: boolean }>;
  // jq context persisted with the plan artifact, needed to resolve deferred step inputs.
  templateContext?: StepTemplateContext;
  actions: ActionRegistry;
  planCtx: PlanCtx;
  triggeredByUserId: string;
  workspaceRoot?: string;
  /** Maps secret name → value (env-derived). */
  secrets?: Record<string, string | undefined>;
  signal?: AbortSignal;
  dryRun?: boolean;
  targetRef?: string;
  /** Same id propagated through all generated rows for audit/observability. */
  requestId?: string;
}

export interface ApplyResult {
  taskId: string;
  status: TaskStatus;
  output: Record<string, unknown>;
  error: string | null;
  rolledBack: boolean;
}

export class PlanExpiredError extends Error {
  constructor(
    public readonly planId: string,
    public readonly expiredAt: Date,
  ) {
    super(`Plan ${planId} expired at ${expiredAt.toISOString()}`);
    this.name = "PlanExpiredError";
  }
}

function defaultTargetRef(plan: Plan): string {
  return `${plan.templateId}:${plan.paramsHash}`;
}

export async function applyPlan(input: ApplyInput): Promise<ApplyResult> {
  const {
    plan,
    resolvedSteps,
    templateContext,
    actions,
    planCtx,
    triggeredByUserId,
    workspaceRoot,
    secrets = {},
    signal: callerSignal,
    dryRun = false,
    targetRef = defaultTargetRef(plan),
    requestId,
  } = input;

  const now = new Date();
  if (new Date(plan.expiresAt).getTime() <= now.getTime()) {
    throw new PlanExpiredError(plan.id, new Date(plan.expiresAt));
  }
  const fresh = await ensurePlanFresh(plan.bindingId, new Date(plan.createdAt));
  if (fresh.stale && fresh.bindingUpdatedAt) {
    throw new StalePlanError(plan.bindingId!, fresh.bindingUpdatedAt);
  }

  const lock = await acquireTargetLock(plan.templateId, targetRef);

  const sandbox = await acquireSandbox({
    taskId: plan.id, // task id mirrors plan id for the v1 1:1 relationship
    target: plan.target,
    workspaceRoot,
  });

  const taskId = randomUUID();
  const redactor = createRedactor(Object.values(secrets));
  const secretAccessor = createSecretAccessor(secrets, redactor);

  await prisma.scaffoldTask.create({
    data: {
      id: taskId,
      planId: plan.id,
      status: "running",
      triggeredByUserId,
      actorKind: plan.actor.kind,
      requestId: requestId ?? null,
      compensations: [],
      steps: {
        create: resolvedSteps.map((s) => ({
          stepId: s.stepId,
          action: s.action,
          status: "pending",
        })),
      },
    },
  });

  const internalAbort = new AbortController();
  const onAbort = () => internalAbort.abort();
  if (callerSignal) {
    if (callerSignal.aborted) internalAbort.abort();
    else callerSignal.addEventListener("abort", onAbort, { once: true });
  }

  const persisted: Array<{ stepId: string; compensation: Compensation }> = [];
  const persistPromises: Promise<unknown>[] = [];

  const result = await execute({
    taskId,
    plan,
    resolvedSteps,
    templateContext,
    actions,
    planCtx,
    workspacePath: sandbox.workspacePath,
    repoRoot: sandbox.repoRoot,
    signal: internalAbort.signal,
    secrets: secretAccessor,
    redactor,
    dryRun,
    emit: (event: StepEvent) => {
      taskEventBus.publish(event);
      persistPromises.push(persistEvent(taskId, event, requestId));
    },
  });

  for (const c of result.compensations) persisted.push(c);

  await Promise.allSettled(persistPromises);

  await prisma.scaffoldTask.update({
    where: { id: taskId },
    data: {
      status: result.status,
      finishedAt: new Date(),
      output: result.output as never,
      error: result.error ?? null,
      compensations: persisted as never,
    },
  });

  if (callerSignal) callerSignal.removeEventListener("abort", onAbort);

  try {
    await lock.release();
  } finally {
    await sandbox.dispose();
  }

  return {
    taskId,
    status: result.status,
    output: result.output,
    error: result.error ?? null,
    rolledBack: result.rolledBack,
  };
}

async function persistEvent(
  taskId: string,
  event: StepEvent,
  requestId: string | undefined,
): Promise<void> {
  switch (event.kind) {
    case "step.started":
      await prisma.scaffoldTaskStep.updateMany({
        where: { taskId, stepId: event.stepId },
        data: { status: "running", startedAt: new Date() },
      });
      return;
    case "step.finished":
      await prisma.scaffoldTaskStep.updateMany({
        where: { taskId, stepId: event.stepId },
        data: {
          status:
            event.status === "succeeded"
              ? "succeeded"
              : event.status === "failed"
                ? "failed"
                : "cancelled",
          finishedAt: new Date(),
          output: (event.output ?? null) as never,
          error: event.error ?? null,
        },
      });
      return;
    case "log":
      await prisma.scaffoldTaskLog.create({
        data: {
          taskId,
          stepId: event.stepId ?? null,
          level: event.level,
          body: event.body,
          requestId: requestId ?? null,
        },
      });
      return;
    case "task.started":
    case "task.finished":
      // Lifecycle is captured in the surrounding ScaffoldTask row update.
      return;
  }
}
