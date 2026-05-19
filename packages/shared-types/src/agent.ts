import type { ID, ISODateString, NamedEntity, Timestamped } from "./common";

export type AgentStatus = "idle" | "running" | "succeeded" | "failed";

/** Adapter selector. */
export type ProviderKind = "openai_compat" | "anthropic" | "gemini";

/** How an agent should treat one specific tool call. */
export type ToolApprovalMode = "auto" | "requires_approval" | "forbidden";

/** Per-tool approval policy for an agent. */
export interface ToolApprovalPolicy {
  [toolName: string]: ToolApprovalMode | Record<string, ToolApprovalMode> | undefined;
  /** Defaults applied when no per-tool entry matches. */
  _sectionDefaults?: Record<string, ToolApprovalMode>;
}

/** Status of a pending autonomous-run approval request. */
export type AgentApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface AgentApprovalRequestDto extends Timestamped {
  id: ID;
  agentUserId: ID;
  agentName: string;
  toolName: string;
  parsedParams: Record<string, unknown>;
  status: AgentApprovalStatus;
  requestedAt: ISODateString;
  decidedByUserId: ID | null;
  decidedAt: ISODateString | null;
  expiresAt: ISODateString;
}

/** Encrypted-at-rest secret (e.g. */
export interface SecretDto extends Timestamped {
  id: ID;
  ownerUserId: ID | null;
  ownerTeamId: ID | null;
  name: string;
  createdAt: ISODateString;
}

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
  ownerUserId: ID | null;
  owningTeamId: ID | null;
  maxToolCalls: number;
  tokenBudget: number | null;
  // New in agents_section_and_identity migration. The backing User row id
  // (User.userKind = 'agent'); same id used for permission checks, audit log
  // actorUserId, team membership, etc.
  userId: ID;
  modelProvider: ProviderKind;
  toolApprovalPolicy: ToolApprovalPolicy;
  tokenBudgetMonthly: number | null;
  tokenBudgetUsed: number;
  costBudgetMonthly: number | null;
  costBudgetUsed: number;
  onBehalfOfRequired: boolean;
  secretId: ID | null;
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
  owningTeamId?: ID | null;
  maxToolCalls?: number;
  tokenBudget?: number | null;
  // Optional in v1 (defaults applied server-side). Wizard sends them.
  modelProvider?: ProviderKind;
  toolApprovalPolicy?: ToolApprovalPolicy;
  onBehalfOfRequired?: boolean;
  /** Role for the backing User row. */
  role?: "admin" | "member";
  secretId?: ID | null;
  tokenBudgetMonthly?: number | null;
  costBudgetMonthly?: number | null;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface RunAgentResponse {
  runId: ID;
  agentId: ID;
  status: AgentStatus;
}
