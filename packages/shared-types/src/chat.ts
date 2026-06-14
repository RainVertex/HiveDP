// Wire contract for the Platform Assistant chatbot, shared by backend SSE executor and frontend.

type ID = string;
type ISODateString = string;

export type ChatRole = "user" | "assistant";

export interface ChatToolCallSummary {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  isError: boolean;
}

export interface ChatAttachmentDto {
  dataUrl: string;
  mimeType: string;
  extractedText: string | null;
}

export interface ChatMessageDto {
  id: ID;
  role: ChatRole;
  content: string;
  toolCalls: ChatToolCallSummary[] | null;
  attachments: ChatAttachmentDto[] | null;
  agentRunId: ID | null;
  reasoning: string | null;
  reasoningDurationMs: number | null;
  createdAt: ISODateString;
}

export interface ChatConversationSummaryDto {
  id: ID;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  lastAssistantAt: ISODateString | null;
  assistantName?: string | null;
  assistantAvatarUrl?: string | null;
}

export interface ChatConversationDetailDto extends ChatConversationSummaryDto {
  messages: ChatMessageDto[];
}

// reason is "model_unavailable" when the assistant agent's model is disabled, missing, or its provider lost its key.
// visionReady is true when a usable vision model is configured, gating image attachments.
export interface ChatConfigDto {
  ready: boolean;
  reason: string | null;
  visionReady: boolean;
}

// Admin config for the assistant's "read the platform's own source" tools.
// credentialSource reports how the backend will reach GitHub for this owner:
// "github_app" when the App is installed on the owner, "pat" when only GITHUB_TOKEN is set,
// "none" when neither is available (the tools will fail at runtime).
export interface ChatSourceRepoDto {
  owner: string;
  repo: string;
  ref: string | null;
  credentialSource: "github_app" | "pat" | "none";
}

export interface ChatTokenEvent {
  text: string;
}

export interface ChatReasoningTokenEvent {
  text: string;
}

export interface ChatReasoningDoneEvent {
  durationMs: number;
}

export interface ChatToolCallStartEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatToolCallEndEvent {
  id: string;
  name: string;
  result?: unknown;
  error?: { message: string };
}

export interface ChatPolicyCheck {
  name: string;
  passed: boolean;
  message: string;
}

// Emitted alongside tool_call_end for any *_prepare tool.
export interface ChatPreviewEvent {
  shortHandle: string;
  toolId: string;
  serverSummary: string;
  parsedParams: Record<string, unknown>;
  sideEffects: string[];
  policyChecks: ChatPolicyCheck[];
}

export interface ChatErrorEvent {
  message: string;
  code?: string;
}

export interface ChatDoneEvent {
  agentRunId: ID;
  finalText: string;
  containsWrites: boolean;
}

// Emitted once per turn when one or more attached MCP servers need the current user to authorize via
// OAuth before their tools become available. The UI renders an "Authorize" link per server.
export interface ChatOAuthRequiredEvent {
  servers: { serverId: ID; label: string; authUrl: string }[];
}

export type ChatSseEvent =
  | { event: "token"; data: ChatTokenEvent }
  | { event: "reasoning_token"; data: ChatReasoningTokenEvent }
  | { event: "reasoning_done"; data: ChatReasoningDoneEvent }
  | { event: "tool_call_start"; data: ChatToolCallStartEvent }
  | { event: "tool_call_end"; data: ChatToolCallEndEvent }
  | { event: "preview"; data: ChatPreviewEvent }
  | { event: "oauth_required"; data: ChatOAuthRequiredEvent }
  | { event: "error"; data: ChatErrorEvent }
  | { event: "done"; data: ChatDoneEvent };

export type ChatSseEventName = ChatSseEvent["event"];
