// Shared types for agents, LLM models/providers, and the admin AI / Models surface.
import type { ID, ISODateString, NamedEntity, Timestamped } from "./common";

export type AgentStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export type ProviderKind = "openai_compat" | "anthropic" | "gemini";

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
  costPer1kIn: number | null;
  costPer1kOut: number | null;
  provider: LlmProviderSummary;
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

export interface Agent extends NamedEntity {
  avatarUrl?: string | null;
  category?: string | null;
  kind: string;
  status: AgentStatus;
  modelId: ID;
  instructions: string;
  toolIds: string[];
  approvalMode: ApprovalMode;
  maxToolCalls: number;
  tokenBudget: number | null;
  temperature: number | null;
  // True when the tool set is code-owned (the Platform Assistant) and persisted toolIds are display-only. The form shows tools read-only.
  toolsManaged?: boolean;
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
  // How the run was started and what it acted on, for the per-agent activity history.
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
  toolIds?: string[];
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
  enabled: boolean;
  isActiveChatModel: boolean;
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
  activeChatModelId: ID | null;
}

export interface ActiveChatModelDto {
  modelId: ID | null;
}

export interface AiRecommendationsDto {
  kind: string;
  requiresTools: boolean;
  recommendedModelIds: ID[];
}
