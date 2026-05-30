import type { ID, ISODateString, NamedEntity, Timestamped } from "./common";

export type AgentStatus = "idle" | "running" | "succeeded" | "failed";

/** Adapter selector derived from the provider kind. */
export type ProviderKind = "openai_compat" | "anthropic" | "gemini";

/** How an agent should treat one specific tool call. */
export type ToolApprovalMode = "auto" | "requires_approval" | "forbidden";

/** Per-tool approval policy (used by the shared decidePolicy helper). */
export interface ToolApprovalPolicy {
  [toolName: string]: ToolApprovalMode | Record<string, ToolApprovalMode> | undefined;
  /** Defaults applied when no per-tool entry matches. */
  _sectionDefaults?: Record<string, ToolApprovalMode>;
}

/** Lean approval mode on an agent: auto-run write tools, or ask first. */
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

export interface Agent extends NamedEntity {
  kind: string;
  status: AgentStatus;
  modelId: ID;
  instructions: string;
  toolIds: string[];
  approvalMode: ApprovalMode;
  maxToolCalls: number;
  tokenBudget: number | null;
  llmModel?: {
    slug: string;
    displayName: string;
    provider: { slug: string; displayName: string };
  };
}

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
  startedAt: ISODateString;
  finishedAt?: ISODateString | null;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  kind?: string;
  modelId: ID;
  instructions: string;
  toolIds?: string[];
  approvalMode?: ApprovalMode;
  maxToolCalls?: number;
  tokenBudget?: number | null;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface RunAgentResponse {
  runId: ID;
  agentId: ID;
  status: AgentStatus;
}

// Admin AI / Models settings surface.

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
  /** True when the provider needs no key (local) or its env key is present. */
  ready: boolean;
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
