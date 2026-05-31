// @internal/llm-core: shared LLM plumbing (adapters, chat client, tool registry, key resolution, settings/readiness) for chat and agents.
export { chat, computeCostUsd } from "./client";
export type { ChatRequest, ChatResult, ResolvedModel } from "./client";

export { selectAdapter, providerKindFromProvider } from "./adapters";
export type { ProviderAdapter, AdapterRequest, AdapterResult } from "./adapters";

export {
  registerTools,
  registerToolGroups,
  resolveTools,
  listAvailableTools,
  listToolGroups,
  _resetExtraTools,
} from "./toolRegistry";
export type {
  RegisteredTool,
  ToolContext,
  ToolDescriptor,
  ToolGroupMeta,
  ToolGroupDescriptor,
} from "./toolRegistry";

export { decidePolicy } from "./approvalPolicy";
export { resolveProviderApiKey } from "./secrets";

export { getSetting, setSetting, clearSetting } from "./settings";
export {
  isProviderReady,
  providerKeyMissingMessage,
  assistantNotConfiguredMessage,
} from "./readiness";
export { recommendationsForKind, type KindRecommendation } from "./recommendations";
export {
  getProviderIdsWithStoredKey,
  providerHasStoredKey,
  setProviderKey,
  clearProviderKey,
} from "./providerCredentials";
