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
    // id keys the registry and skill selection, openaiDef.function.name is what the model calls, so
    // they must stay identical or the two paths resolve to different tools.
    if (t.openaiDef.function.name !== t.id) {
      throw new Error(
        `Tool "${t.id}" has mismatched openaiDef.function.name "${t.openaiDef.function.name}"`,
      );
    }
    REGISTRY.set(t.id, t);
  }
}

// Tool group identity. Labels are localized in the frontend by group id, so only the id and the
// picker sort order live here.
export interface ToolGroupMeta {
  id: string;
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

// Every registered tool id, used to validate that skills reference real tools.
export function listRegisteredToolIds(): string[] {
  return [...REGISTRY.keys()];
}

export interface ToolGroupDescriptor {
  id: string;
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
  const groups: ToolGroupDescriptor[] = [...buckets.entries()].map(([groupId, tools]) => ({
    id: groupId,
    tools,
  }));
  // order from meta, then id, so the picker is stable across boots.
  groups.sort((a, b) => {
    const oa = GROUP_META.get(a.id)?.order ?? 999;
    const ob = GROUP_META.get(b.id)?.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
  return groups;
}

// Resolve tool ids to their registered tools, skipping any id that is not currently registered.
// Skills reference tool ids that may have been removed or renamed, so resolution must be lenient: a
// missing tool is dropped rather than throwing. Order follows the input, and a tool id repeated
// across the input appears once.
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
