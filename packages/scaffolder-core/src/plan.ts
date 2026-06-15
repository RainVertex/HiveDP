import { randomUUID } from "node:crypto";
import type { Actor, Capability, Plan, PlanMode, PlanStep, SandboxTarget } from "./types";
import type { CompiledTemplate } from "./template";
import type { ActionRegistry } from "./actions/registry";
import type { ReadCtx } from "./actions/types";
// Walks a template's plan(), resolves each step, and assembles an immutable Plan artifact.
import { paramsHash } from "./fingerprint";
import { containsToken, resolveTokens, type StepTemplateContext } from "./tokens";

export interface BuildPlanInput<TParams> {
  template: CompiledTemplate<TParams>;
  rawParams: unknown;
  actor: Actor;
  ctx: ReadCtx;
  templateContentHash: string;
  target: SandboxTarget;
  bindingId?: string | null;
  actions: ActionRegistry;
  // jq context for {{ }} step-input templating, user/entity halves of StepTemplateContext.
  user?: Record<string, unknown> | null;
  entity?: Record<string, unknown> | null;
  // Caller supplies so it can be persisted alongside the artifact.
  planId?: string;
  now?: Date;
}

export interface BuiltPlan {
  plan: Plan;
  // Steps with their plan-time resolved input, deferred steps re-resolve at apply time.
  resolvedSteps: Array<{ stepId: string; action: string; input: unknown; deferred?: boolean }>;
  // Persisted alongside the artifact so apply can rebuild the same jq context.
  templateContext: StepTemplateContext;
}

export async function buildPlan<TParams>(input: BuildPlanInput<TParams>): Promise<BuiltPlan> {
  const {
    template,
    rawParams,
    actor,
    ctx,
    templateContentHash,
    target,
    bindingId = null,
    actions,
    user = null,
    entity = null,
    planId = randomUUID(),
    now = ctx.now(),
  } = input;

  const params = template.parameters.parse(rawParams);
  const steps = await template.plan(params, ctx);

  const templateContext: StepTemplateContext = {
    parameters: params as Record<string, unknown>,
    user,
    entity,
  };

  const planSteps: PlanStep[] = [];
  const resolvedSteps: BuiltPlan["resolvedSteps"] = [];
  const allCapabilities = new Set<Capability>();
  let irreversible = false;
  // mode: no-op if every step matches, update if any drifts with a binding, else create.
  let anyAbsent = false;
  let anyDrift = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const action = actions.require(step.action);
    const stepId = step.id ?? `${action.id}-${i}`;
    const planInput = resolveTokens(step.input, templateContext, "plan");
    // Steps still holding .steps tokens validate and diff at apply time instead.
    const deferred = containsToken(planInput);

    for (const c of action.capabilities) allCapabilities.add(c);
    if (action.irreversible) irreversible = true;

    if (deferred) {
      anyAbsent = true;
      planSteps.push({
        stepId,
        action: action.id,
        capabilities: [...action.capabilities],
        mutations: [],
        reversible: !action.irreversible,
        matched: "absent",
      });
      resolvedSteps.push({ stepId, action: action.id, input: planInput, deferred: true });
      continue;
    }

    const inputParsed = action.schema.parse(planInput);

    const matched = await action.match(inputParsed, ctx);
    if (matched === "absent") anyAbsent = true;
    if (matched === "drift") anyDrift = true;

    const mutations = matched === "match" ? [] : await action.diff(inputParsed, ctx);

    planSteps.push({
      stepId,
      action: action.id,
      capabilities: [...action.capabilities],
      mutations,
      reversible: !action.irreversible,
      matched,
    });
    resolvedSteps.push({ stepId, action: action.id, input: inputParsed });
  }

  const mode: PlanMode = !anyAbsent && !anyDrift ? "no-op" : bindingId ? "update" : "create";

  const capabilities = [...allCapabilities];

  const expiresAt = new Date(now.getTime() + template.resolvedPlanTtlSeconds * 1000);

  const plan: Plan = {
    id: planId,
    templateId: template.metadata.id,
    templateVersion: template.metadata.version,
    templateContentHash,
    params: params as Record<string, unknown>,
    paramsHash: paramsHash(params),
    bindingId,
    mode,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    target,
    capabilities,
    irreversible,
    steps: planSteps,
    actor,
  };
  return { plan, resolvedSteps, templateContext };
}
