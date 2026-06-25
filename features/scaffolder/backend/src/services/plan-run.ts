import { prisma } from "@internal/db";
import {
  buildPlan,
  contentHashForTemplate,
  paramsHash as computeParamsHash,
  resolveTarget,
  toJsonSchema,
  type Actor,
  type Plan,
  type SandboxTarget,
  type StepTemplateContext,
} from "@internal/scaffolder-core";
import { filterByTemplateAcl } from "./acl";
import { getActionRegistry, getTemplates } from "./registry";
import { buildPlanCtx } from "./plan-ctx";
import { buildUserContext } from "./jq-context";
import { applyPlan, PlanExpiredError } from "./apply";
import { StalePlanError, TargetLockBusyError } from "./locks";
import { loadEnvSecrets } from "./secrets";

// Shared plan/apply logic for any in-process or token-bearing agent. The scaffolder MCP router and the
// platform agent tools both go through these so the ACL, audit, and lifecycle handling stay identical.

interface AuditMeta {
  actorIp?: string | null;
  requestId?: string | null;
}

async function writeAudit(
  userId: string,
  meta: AuditMeta,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        actorUserId: userId,
        actorIp: meta.actorIp ?? null,
        requestId: meta.requestId ?? null,
        kind,
        payload: payload as never,
      },
    })
    .catch(() => {});
}

export interface ExecutableTemplate {
  id: string;
  name: string;
  description: string;
  parameters: unknown;
}

// Create-operation templates the actor is allowed to execute, with their parameters as JSON schema so
// a model can see what scaffolder_plan expects.
export async function listExecutableTemplates(input: {
  actor: Actor;
  isAdmin: boolean;
}): Promise<ExecutableTemplate[]> {
  const templates = (await getTemplates()).list();
  const visible = await filterByTemplateAcl(templates, input.actor, input.isAdmin, true);
  return visible
    .filter((t) => t.metadata.audience.includes("agent"))
    .filter((t) => t.resolvedOperation === "create")
    .map((t) => ({
      id: t.metadata.id,
      name: t.metadata.name,
      description: t.metadata.description,
      parameters: toJsonSchema(t.parameters),
    }));
}

export async function buildAndPersistPlan(input: {
  templateId: string;
  rawParams: unknown;
  actor: Actor;
  userId: string;
  audit?: AuditMeta;
}): Promise<Plan> {
  const template = (await getTemplates()).get(input.templateId);
  if (!template) throw new Error(`Unknown template: ${input.templateId}`);
  const allowed = await filterByTemplateAcl([template], input.actor, false, true);
  if (allowed.length === 0) throw new Error("Forbidden");
  const target = resolveTarget(template, "agent");
  const planCtx = buildPlanCtx({ actor: input.actor, target });
  const contentHash = contentHashForTemplate(template);
  const user = await buildUserContext(input.userId);
  const phash = computeParamsHash(input.rawParams);
  const existingBinding = await prisma.scaffoldBinding.findFirst({
    where: { templateId: template.metadata.id, paramsHash: phash, active: true },
    select: { id: true },
  });
  const built = await buildPlan({
    template,
    rawParams: input.rawParams ?? {},
    actor: input.actor,
    ctx: planCtx,
    templateContentHash: contentHash,
    target,
    bindingId: existingBinding?.id ?? null,
    actions: getActionRegistry(),
    user,
  });
  await prisma.scaffoldPlan.create({
    data: {
      id: built.plan.id,
      templateId: built.plan.templateId,
      templateVersion: built.plan.templateVersion,
      templateHash: built.plan.templateContentHash,
      params: built.plan.params as never,
      paramsHash: built.plan.paramsHash,
      mode: built.plan.mode === "no-op" ? "no_op" : built.plan.mode,
      target: built.plan.target,
      capabilities: built.plan.capabilities,
      irreversible: built.plan.irreversible,
      bindingId: built.plan.bindingId,
      artifact: {
        steps: built.plan.steps,
        resolvedSteps: built.resolvedSteps,
        templateContext: built.templateContext,
      } as never,
      createdByUserId: input.userId,
      actorKind: input.actor.kind,
      createdAt: new Date(built.plan.createdAt),
      expiresAt: new Date(built.plan.expiresAt),
    },
  });
  await writeAudit(input.userId, input.audit ?? {}, "scaffolder.plan.created", {
    planId: built.plan.id,
    templateId: built.plan.templateId,
    templateVersion: built.plan.templateVersion,
    mode: built.plan.mode,
    target: built.plan.target,
    actorKind: input.actor.kind,
  });
  return built.plan;
}

export type ApplyPlanOutcome =
  | {
      kind: "ok";
      taskId: string;
      status: string;
      output: Record<string, unknown>;
      error: string | null;
      rolledBack: boolean;
    }
  | { kind: "error"; reason: string };

export async function applyPersistedPlan(input: {
  planId: string;
  dryRun: boolean;
  actor: Actor;
  userId: string;
  audit?: AuditMeta;
}): Promise<ApplyPlanOutcome> {
  const planRow = await prisma.scaffoldPlan.findUnique({ where: { id: input.planId } });
  if (!planRow) return { kind: "error", reason: "Plan not found" };
  if (planRow.createdByUserId !== input.userId) return { kind: "error", reason: "Forbidden" };
  if (planRow.appliedTaskId) return { kind: "error", reason: "Plan already applied" };

  const artifact = planRow.artifact as unknown as {
    steps: Awaited<ReturnType<typeof buildPlan>>["plan"]["steps"];
    resolvedSteps: Array<{ stepId: string; action: string; input: unknown; deferred?: boolean }>;
    templateContext?: StepTemplateContext;
  };
  const plan = {
    id: planRow.id,
    templateId: planRow.templateId,
    templateVersion: planRow.templateVersion,
    templateContentHash: planRow.templateHash,
    params: planRow.params as Record<string, unknown>,
    paramsHash: planRow.paramsHash,
    bindingId: planRow.bindingId,
    mode: (planRow.mode === "no_op" ? "no-op" : planRow.mode) as "create" | "update" | "no-op",
    createdAt: planRow.createdAt.toISOString(),
    expiresAt: planRow.expiresAt.toISOString(),
    target: planRow.target as SandboxTarget,
    capabilities: planRow.capabilities as Awaited<
      ReturnType<typeof buildPlan>
    >["plan"]["capabilities"],
    irreversible: planRow.irreversible,
    steps: artifact.steps,
    actor: input.actor,
  };
  const planCtx = buildPlanCtx({ actor: input.actor, target: plan.target });
  try {
    const result = await applyPlan({
      plan,
      resolvedSteps: artifact.resolvedSteps,
      ...(artifact.templateContext ? { templateContext: artifact.templateContext } : {}),
      actions: getActionRegistry(),
      planCtx,
      triggeredByUserId: input.userId,
      dryRun: input.dryRun,
      requestId: input.audit?.requestId ?? undefined,
      secrets: loadEnvSecrets(),
    });
    if (!input.dryRun) {
      await prisma.scaffoldPlan.update({
        where: { id: planRow.id },
        data: { appliedTaskId: result.taskId },
      });
      await writeAudit(input.userId, input.audit ?? {}, "scaffolder.task.applied", {
        taskId: result.taskId,
        planId: planRow.id,
        templateId: planRow.templateId,
        status: result.status,
        rolledBack: result.rolledBack,
      });
    }
    return {
      kind: "ok",
      taskId: result.taskId,
      status: result.status,
      output: result.output,
      error: result.error,
      rolledBack: result.rolledBack,
    };
  } catch (err) {
    if (err instanceof PlanExpiredError) return { kind: "error", reason: "Plan expired" };
    if (err instanceof StalePlanError)
      return { kind: "error", reason: "Plan stale, replan required" };
    if (err instanceof TargetLockBusyError) return { kind: "error", reason: "Target busy" };
    return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}
