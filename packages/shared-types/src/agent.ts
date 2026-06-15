// Shared types for agents, LLM models/providers, and the admin AI / Models surface.
import type { ID, ISODateString, NamedEntity, Timestamped } from "./common";

export type AgentStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export type ProviderKind = "openai_compat" | "openai_responses" | "anthropic" | "gemini";

export type ToolApprovalMode = "auto" | "requires_approval" | "forbidden";

export interface ToolApprovalPolicy {
  [toolName: string]: ToolApprovalMode | Record<string, ToolApprovalMode> | undefined;
  _sectionDefaults?: Record<string, ToolApprovalMode>;
}

export type ApprovalMode = "auto" | "ask";

export interface LlmProviderSummary {
  slug: string;
  displayName: string;
  kind: string;
}

export interface LlmModelSummary {
  id: ID;
  slug: string;
  displayName: string;
  modelName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  costPer1kIn: number | null;
  costPer1kOut: number | null;
  provider: LlmProviderSummary;
  // False when the model's provider has no usable API key, so the model cannot actually run yet.
  providerReady: boolean;
}

export interface AgentToolDescriptor {
  id: string;
  name: string;
  description: string;
}

export interface AgentToolGroup {
  id: string;
  label: string;
  description: string;
  tools: AgentToolDescriptor[];
}

export interface AgentToolsResponse {
  items: AgentToolDescriptor[];
  groups: AgentToolGroup[];
}

// An admin-composed bundle of registry tools. tools are resolved from toolIds against the current
// registry for display, so a tool that is unregistered (env-gated off) simply does not appear.
export interface SkillSummary {
  id: ID;
  label: string;
  description: string | null;
  guidance: string | null;
  toolIds: string[];
  builtin: boolean;
  tools: AgentToolDescriptor[];
}

export interface CreateSkillInput {
  label: string;
  description?: string | null;
  guidance?: string | null;
  toolIds?: string[];
}

export type UpdateSkillInput = Partial<CreateSkillInput>;

export type McpAuthKind = "none" | "bearer" | "oauth";

export interface McpToolInfo {
  name: string;
  description: string;
}

// One external MCP server attached to an agent. Secrets are never returned: a stored bearer token
// shows only as hasBearerToken, and OAuth state shows only as oauthConnected for the current user.
export interface AgentMcpServerSummary {
  id: ID;
  agentId: ID;
  label: string;
  url: string;
  authKind: McpAuthKind;
  hasBearerToken: boolean;
  oauthScope: string | null;
  oauthConnected: boolean;
  toolAllowlist: string[];
  toolPrefix: string;
  enabled: boolean;
  lastError: string | null;
  lastConnectedAt: ISODateString | null;
}

export interface CreateAgentMcpServerInput {
  label: string;
  url: string;
  authKind?: McpAuthKind;
  // Plaintext bearer token, write-only. Sent only when authKind is "bearer".
  bearerToken?: string | null;
  oauthScope?: string | null;
  toolAllowlist?: string[];
  toolPrefix?: string;
  enabled?: boolean;
}

export type UpdateAgentMcpServerInput = Partial<CreateAgentMcpServerInput>;

export type McpProbeResult =
  | { status: "ok"; tools: McpToolInfo[] }
  | { status: "needs_auth"; authUrl: string }
  | { status: "error"; message: string };

export interface Agent extends NamedEntity {
  avatarUrl?: string | null;
  category?: string | null;
  kind: string;
  status: AgentStatus;
  modelId: ID;
  instructions: string;
  skillIds: string[];
  approvalMode: ApprovalMode;
  maxToolCalls: number;
  tokenBudget: number | null;
  temperature: number | null;
  mcpServers?: AgentMcpServerSummary[];
  llmModel?: {
    slug: string;
    displayName: string;
    provider: { slug: string; displayName: string };
  };
}

export type AgentRunTrigger = "chat" | "task" | "test" | "manual" | "cron";

export interface AgentRun extends Timestamped {
  id: ID;
  agentId: ID;
  status: AgentStatus;
  input: unknown;
  output?: unknown;
  error?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  costUsd?: number | null;
  containsWrites?: boolean;
  startedAt: ISODateString;
  finishedAt?: ISODateString | null;
  trigger?: AgentRunTrigger | null;
  task?: { id: ID; title: string; projectId: ID } | null;
  conversation?: { id: ID; title: string } | null;
  agent?: { name: string; avatarUrl?: string | null } | null;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  avatarUrl?: string | null;
  category?: string | null;
  kind?: string;
  modelId: ID;
  instructions: string;
  skillIds?: string[];
  approvalMode?: ApprovalMode;
  maxToolCalls?: number;
  tokenBudget?: number | null;
  temperature?: number | null;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface RunAgentResponse {
  runId: ID;
  agentId: ID;
  status: AgentStatus;
}

export interface AdminAiModelRow {
  id: ID;
  slug: string;
  displayName: string;
  modelName: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  enabled: boolean;
}

export interface AdminAiProviderGroup {
  slug: string;
  displayName: string;
  kind: string;
  ready: boolean;
  hasStoredKey: boolean;
  apiKeyEnvVar: string | null;
  models: AdminAiModelRow[];
}

export interface AdminAiModelsResponse {
  providers: AdminAiProviderGroup[];
}

export interface AiRecommendationsDto {
  kind: string;
  requiresTools: boolean;
  recommendedModelIds: ID[];
}
