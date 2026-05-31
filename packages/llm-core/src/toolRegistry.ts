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
}

const REGISTRY: Map<string, RegisteredTool> = new Map();

export function registerTools(tools: RegisteredTool[]): void {
  for (const t of tools) REGISTRY.set(t.id, t);
}

export function _resetExtraTools(): void {
  REGISTRY.clear();
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

// Order is preserved so the model sees a stable tool list across runs of the same agent.
export function resolveTools(toolIds: string[]): RegisteredTool[] {
  return toolIds.map((id) => {
    const t = REGISTRY.get(id);
    if (!t) throw new Error(`Unknown tool: ${id}`);
    return t;
  });
}
