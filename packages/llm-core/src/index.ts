// @internal/llm-core: shared LLM plumbing (adapters, chat client, tool registry, key resolution, settings/readiness) for chat and agents.
export { computeCostUsd } from "./client";
export type { ChatRequest, ChatResult, ResolvedModel, TokenUsage } from "./client";

export { selectAdapter, providerKindFromProvider } from "./adapters";
export type { ProviderAdapter, AdapterRequest, AdapterResult } from "./adapters";

export {
  registerTools,
  registerToolGroups,
  getRegisteredTools,
  listRegisteredToolIds,
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
export { validateProviderKeyFormat } from "./keyFormat";
export {
  getProviderIdsWithStoredKey,
  providerHasStoredKey,
  setProviderKey,
  clearProviderKey,
} from "./providerCredentials";

export { encryptSecret, decryptSecret } from "./crypto";

export {
  openMcpToolset,
  openAgentMcpToolset,
  probeMcpServer,
  completeMcpOAuth,
  toMcpServerConfig,
  mcpOAuthRedirectUrl,
  MCP_OAUTH_CALLBACK_PATH,
  type McpProbeResult,
} from "./mcp/connect";
export type {
  McpServerConfig,
  McpResolveOptions,
  McpToolInfo,
  McpToolset,
  McpAuthPrompt,
} from "./mcp/types";
