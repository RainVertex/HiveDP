// Shared tool registry for chat and agents; starts empty so this package carries no feature tools.

import type OpenAI from "openai";

export interface ToolContext {
  // null for system / cron runs. required for actor-bound tools.
  userId: string | null;
  isAdmin: boolean;
  teamIds: string[];
  signal?: AbortSignal;
}

export interface RegisteredTool {
  id: string;
  openaiDef: OpenAI.Chat.Completions.ChatCompletionFunctionTool;
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
  // Group id used only to organize tools in the agent UI; never sent to the model.
  group?: string;
}

const REGISTRY: Map<string, RegisteredTool> = new Map();

export function registerTools(tools: RegisteredTool[]): void {
  for (const t of tools) {
    // Under the skills model every tool must belong to a group (a skill), else it is unreachable.
    if (!t.group) throw new Error(`Tool "${t.id}" was registered without a group`);
    REGISTRY.set(t.id, t);
  }
}

// Display metadata for a tool group; tools reference a group by its id.
export interface ToolGroupMeta {
  id: string;
  label: string;
  description?: string;
  order?: number;
}

const GROUP_META: Map<string, ToolGroupMeta> = new Map();

export function registerToolGroups(groups: ToolGroupMeta[]): void {
  for (const g of groups) GROUP_META.set(g.id, g);
}

export function _resetExtraTools(): void {
  REGISTRY.clear();
  GROUP_META.clear();
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
}

// Tool metadata for the UI multiselect; today all registered tools are visible.
export function listAvailableTools(_ctx: ToolContext): ToolDescriptor[] {
  return [...REGISTRY.values()].map((t) => ({
    id: t.id,
    name: t.openaiDef.function.name,
    description: t.openaiDef.function.description ?? "",
  }));
}

export interface ToolGroupDescriptor {
  id: string;
  label: string;
  description: string;
  tools: ToolDescriptor[];
}

// Registered tools bucketed by group for the grouped agent tool picker.
export function listToolGroups(_ctx: ToolContext): ToolGroupDescriptor[] {
  const buckets = new Map<string, ToolDescriptor[]>();
  for (const t of REGISTRY.values()) {
    const groupId = t.group ?? "other";
    const arr = buckets.get(groupId) ?? [];
    arr.push({
      id: t.id,
      name: t.openaiDef.function.name,
      description: t.openaiDef.function.description ?? "",
    });
    buckets.set(groupId, arr);
  }
  const groups: ToolGroupDescriptor[] = [...buckets.entries()].map(([groupId, tools]) => {
    const meta = GROUP_META.get(groupId);
    return {
      id: groupId,
      label: meta?.label ?? groupId,
      description: meta?.description ?? "",
      tools,
    };
  });
  // order from meta, then label, so the picker is stable across boots.
  groups.sort((a, b) => {
    const oa = GROUP_META.get(a.id)?.order ?? 999;
    const ob = GROUP_META.get(b.id)?.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

// Order is preserved so the model sees a stable tool list across runs of the same agent.
export function resolveTools(toolIds: string[]): RegisteredTool[] {
  return toolIds.map((id) => {
    const t = REGISTRY.get(id);
    if (!t) throw new Error(`Unknown tool: ${id}`);
    return t;
  });
}

// Resolve tool ids to their registered tools, skipping any id that is not currently registered.
// Skills reference tool ids that may be env-gated off (e.g. chat writes) or removed, so resolution
// must be lenient: a missing tool is dropped rather than throwing. Order follows the input, and a
// tool id repeated across the input appears once.
export function getRegisteredTools(toolIds: string[]): RegisteredTool[] {
  const seen = new Set<string>();
  const out: RegisteredTool[] = [];
  for (const id of toolIds) {
    if (seen.has(id)) continue;
    const tool = REGISTRY.get(id);
    if (!tool) continue;
    seen.add(id);
    out.push(tool);
  }
  return out;
}
