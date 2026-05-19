import type { ZodType } from "zod";
import type { Audience, Capability, SandboxTarget } from "./types";
import type { PlanCtx } from "./plan-ctx";

export interface DefaultTargetMap {
  agent: SandboxTarget;
  human: SandboxTarget;
}

export interface TemplateMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  tags?: readonly string[];
  icon?: string;
  audience: readonly Audience[];
  requiredRole: "admin" | "member";
  planTtlSeconds?: number;
  defaultTarget?: DefaultTargetMap;
}

export interface Step {
  action: string;
  input: unknown;
  /** Optional override of the auto-generated step id. */
  id?: string;
}

export type PlanFn<TParams> = (params: TParams, ctx: PlanCtx) => Step[] | Promise<Step[]>;

export interface TemplateDefinition<TParams = unknown> {
  metadata: TemplateMetadata;
  parameters: ZodType<TParams>;
  capabilities: Capability[];
  // Method-shorthand (not property) so the position is bivariant under
  // strictFunctionTypes — lets the registry hold heterogeneous templates as
  // CompiledTemplate<unknown> without per-template casts at registration.
  plan(params: TParams, ctx: PlanCtx): Step[] | Promise<Step[]>;
}

export interface CompiledTemplate<TParams = unknown> extends TemplateDefinition<TParams> {
  resolvedDefaultTarget: DefaultTargetMap;
  resolvedPlanTtlSeconds: number;
}

const DEFAULT_PLAN_TTL_SECONDS = 1800;
const DEFAULT_TARGETS: DefaultTargetMap = { agent: "branch", human: "main" };

export function defineTemplate<TParams>(
  def: TemplateDefinition<TParams>,
): CompiledTemplate<TParams> {
  const { metadata } = def;
  if (!/^[a-z][a-z0-9-]*$/.test(metadata.id)) {
    throw new Error(
      `Invalid template id "${metadata.id}": must be kebab-case starting with a letter.`,
    );
  }
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)) {
    throw new Error(
      `Invalid template version "${metadata.version}": expected semver (e.g. 1.2.3).`,
    );
  }

  return {
    ...def,
    resolvedDefaultTarget: metadata.defaultTarget ?? DEFAULT_TARGETS,
    resolvedPlanTtlSeconds: metadata.planTtlSeconds ?? DEFAULT_PLAN_TTL_SECONDS,
  };
}

/** Resolves the sandbox target for a given actor, honoring template-declared defaults and an */
export function resolveTarget(
  template: CompiledTemplate,
  actorKind: Audience,
  override?: SandboxTarget,
): SandboxTarget {
  if (override) return override;
  return template.resolvedDefaultTarget[actorKind];
}

// AnyTemplate erases TParams via a cast through `unknown`, sidestepping
// invariance on plan(): the registry is inherently heterogeneous and only
// reads `metadata` / `resolvedVisibility`, never re-invokes plan() with a
// typed param.
type AnyTemplate = CompiledTemplate<unknown>;

class TemplateRegistry {
  private readonly byId = new Map<string, AnyTemplate>();

  register<TParams>(template: CompiledTemplate<TParams>): void {
    if (this.byId.has(template.metadata.id)) {
      throw new Error(`Duplicate template id: ${template.metadata.id}`);
    }
    this.byId.set(template.metadata.id, template as unknown as AnyTemplate);
  }

  unregister(id: string): void {
    this.byId.delete(id);
  }

  get(id: string): AnyTemplate | undefined {
    return this.byId.get(id);
  }

  list(): AnyTemplate[] {
    return Array.from(this.byId.values()).sort((a, b) =>
      a.metadata.id.localeCompare(b.metadata.id),
    );
  }

  clear(): void {
    this.byId.clear();
  }
}

export function createTemplateRegistry(): TemplateRegistry {
  return new TemplateRegistry();
}

export type { TemplateRegistry };
