// @internal/llm-core: shared LLM plumbing used by both the chat feature and
// the agents domain. Provider adapters, the chat-completion client, the tool
// registry, approval-policy resolution, provider key resolution, plus the
// settings/readiness/recommendation helpers the admin AI surface needs.

export { chat, computeCostUsd } from "./client";
export type { ChatRequest, ChatResult, ResolvedModel } from "./client";

export { selectAdapter, providerKindFromProvider } from "./adapters";
export type { ProviderAdapter, AdapterRequest, AdapterResult } from "./adapters";

export { registerTools, resolveTools, listAvailableTools, _resetExtraTools } from "./toolRegistry";
export type { RegisteredTool, ToolContext, ToolDescriptor } from "./toolRegistry";

export { decidePolicy } from "./approvalPolicy";
export { resolveProviderApiKey } from "./secrets";

export { getSetting, setSetting, clearSetting } from "./settings";
export { isProviderReady } from "./readiness";
export { recommendationsForKind, type KindRecommendation } from "./recommendations";
