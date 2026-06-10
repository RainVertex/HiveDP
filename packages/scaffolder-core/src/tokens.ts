// Port-style {{ <jq> }} step-input templating with two-phase resolution.
// Plan phase resolves .inputs/.user/.entity/.operation, apply phase additionally
// resolves .steps.<id>.outputs.* once prior step outputs exist.
import { evalJq } from "./jq";

export interface StepTemplateContext {
  inputs: Record<string, unknown>;
  user: Record<string, unknown> | null;
  entity: Record<string, unknown> | null;
  operation: string;
  steps?: Record<string, { outputs: unknown }>;
}

const TOKEN_RE = /\{\{([\s\S]+?)\}\}/g;
const HAS_TOKEN_RE = /\{\{[\s\S]+?\}\}/;
const FULL_TOKEN_RE = /^\{\{([\s\S]+?)\}\}$/;
const STEPS_REF_RE = /(^|[^A-Za-z0-9_])\.steps\b/;

export function containsToken(value: unknown): boolean {
  if (typeof value === "string") return HAS_TOKEN_RE.test(value);
  if (Array.isArray(value)) return value.some(containsToken);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsToken);
  }
  return false;
}

function filterReferencesSteps(filter: string): boolean {
  return STEPS_REF_RE.test(filter);
}

function toEmbeddedString(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}

async function resolveString(
  value: string,
  ctx: StepTemplateContext,
  phase: "plan" | "apply",
): Promise<unknown> {
  const jqInput = {
    inputs: ctx.inputs,
    user: ctx.user,
    entity: ctx.entity,
    operation: ctx.operation,
    steps: ctx.steps ?? {},
  };

  const full = FULL_TOKEN_RE.exec(value.trim());
  if (full) {
    const filter = full[1]!.trim();
    if (phase === "plan" && filterReferencesSteps(filter)) return value;
    return evalJq(jqInput, filter);
  }

  const parts: Array<string | Promise<unknown>> = [];
  let lastIndex = 0;
  for (const match of value.matchAll(TOKEN_RE)) {
    parts.push(value.slice(lastIndex, match.index));
    const filter = match[1]!.trim();
    if (phase === "plan" && filterReferencesSteps(filter)) {
      // Deferred tokens stay verbatim so the apply pass can resolve them.
      parts.push(match[0]);
    } else {
      parts.push(evalJq(jqInput, filter));
    }
    lastIndex = match.index + match[0].length;
  }
  parts.push(value.slice(lastIndex));

  const settled = await Promise.all(parts);
  return settled.map(toEmbeddedString).join("");
}

export async function resolveTokens(
  value: unknown,
  ctx: StepTemplateContext,
  phase: "plan" | "apply",
): Promise<unknown> {
  if (typeof value === "string") return resolveString(value, ctx, phase);
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveTokens(v, ctx, phase)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveTokens(v, ctx, phase);
    }
    return out;
  }
  return value;
}
