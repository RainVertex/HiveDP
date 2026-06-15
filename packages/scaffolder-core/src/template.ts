// Template definition, compilation, and registry for scaffolder templates.
import type { ZodType } from "zod";
import type { Audience, Capability, SandboxTarget, TemplateOperation } from "./types";
import type { PlanCtx } from "./plan-ctx";
import { stableStringify, templateContentHash } from "./fingerprint";

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
  // Defaults to "create". day2/delete templates run against an existing catalog entity.
  operation?: TemplateOperation;
}

export interface Step {
  action: string;
  input: unknown;
  id?: string;
}

export type PlanFn<TParams> = (params: TParams, ctx: PlanCtx) => Step[] | Promise<Step[]>;

export interface TemplateDefinition<TParams = unknown> {
  metadata: TemplateMetadata;
  parameters: ZodType<TParams>;
  capabilities: Capability[];
  // Raw declarative source (Port-style JSON) for templates loaded from data, drives form resolution and content hashing.
  definitionSource?: unknown;
  // Method-shorthand (not property) keeps plan() bivariant so the registry can hold CompiledTemplate<unknown>.
  plan(params: TParams, ctx: PlanCtx): Step[] | Promise<Step[]>;
}

export interface CompiledTemplate<TParams = unknown> extends TemplateDefinition<TParams> {
  resolvedDefaultTarget: DefaultTargetMap;
  resolvedPlanTtlSeconds: number;
  resolvedOperation: TemplateOperation;
}

const DEFAULT_PLAN_TTL_SECONDS = 1800;
const DEFAULT_TARGETS: DefaultTargetMap = { agent: "worktree", human: "worktree" };

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
    resolvedOperation: metadata.operation ?? "create",
  };
}

// Declarative templates hash their full definition so edits surface as drift.
export function contentHashForTemplate(tpl: {
  metadata: TemplateMetadata;
  definitionSource?: unknown;
}): string {
  return templateContentHash({
    templateId: tpl.metadata.id,
    version: tpl.metadata.version,
    moduleSource: tpl.definitionSource
      ? stableStringify(tpl.definitionSource)
      : tpl.metadata.id + tpl.metadata.version,
  });
}

export function resolveTarget(
  template: CompiledTemplate,
  actorKind: Audience,
  override?: SandboxTarget,
): SandboxTarget {
  if (override) return override;
  return template.resolvedDefaultTarget[actorKind];
}

// Erases TParams so the heterogeneous registry can store templates without per-template casts.
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
