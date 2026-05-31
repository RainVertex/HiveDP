import type { ToolApprovalMode, ToolApprovalPolicy } from "@internal/shared-types";

// Resolves a tool's approval mode: per-tool entry, then section default, then global default.

// Defaults cautiously; chat-driven prepare/submit confirmation already satisfies "requires_approval".
const GLOBAL_DEFAULT: ToolApprovalMode = "requires_approval";

export function decidePolicy(
  policy: ToolApprovalPolicy | null | undefined,
  toolName: string,
): ToolApprovalMode {
  if (!policy) return GLOBAL_DEFAULT;

  const direct = (policy as Record<string, unknown>)[toolName];
  if (isMode(direct)) return direct;

  // Tools are named <section>_<verb>(_<phase>?), so the section is the token before the first underscore.
  const section = sectionFromToolName(toolName);
  const sectionDef = policy._sectionDefaults?.[section];
  if (isMode(sectionDef)) return sectionDef;

  return GLOBAL_DEFAULT;
}

function sectionFromToolName(toolName: string): string {
  const idx = toolName.indexOf("_");
  return idx === -1 ? toolName : toolName.slice(0, idx);
}

function isMode(value: unknown): value is ToolApprovalMode {
  return value === "auto" || value === "requires_approval" || value === "forbidden";
}
