import type OpenAI from "openai";

// Shared tool registry for chat and agents. Tools register at server startup:
// chat tools via registerChatTools(), agent/catalog tools via
// registerAgentTools(). The agentic loops resolve an agent's declared toolIds
// to concrete defs + handlers through this registry. The registry starts
// empty so this package carries no feature-specific tool implementations.

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

/** Add tools to the global registry at startup. */
export function registerTools(tools: RegisteredTool[]): void {
  for (const t of tools) REGISTRY.set(t.id, t);
}

/** Internal, for tests that want a clean slate. */
export function _resetExtraTools(): void {
  REGISTRY.clear();
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
}

// Lightweight metadata for the UI tool-multiselect: every tool currently
// registered. Filtered by what the caller is allowed to see (today all
// registered tools are visible to authenticated users).
export function listAvailableTools(_ctx: ToolContext): ToolDescriptor[] {
  return [...REGISTRY.values()].map((t) => ({
    id: t.id,
    name: t.openaiDef.function.name,
    description: t.openaiDef.function.description ?? "",
  }));
}

// Resolve an Agent's declared toolIds to concrete defs + handlers. Order is
// preserved so the model sees a stable tool list across runs of the same
// agent.
export function resolveTools(toolIds: string[]): RegisteredTool[] {
  return toolIds.map((id) => {
    const t = REGISTRY.get(id);
    if (!t) throw new Error(`Unknown tool: ${id}`);
    return t;
  });
}
