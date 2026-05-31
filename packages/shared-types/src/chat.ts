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

export interface ChatMessageDto {
  id: ID;
  role: ChatRole;
  content: string;
  toolCalls: ChatToolCallSummary[] | null;
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

// reason is "no_active_model" when none selected, "model_unavailable" when selected model is disabled or lost its key.
export interface ChatConfigDto {
  ready: boolean;
  reason: string | null;
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

export type ChatSseEvent =
  | { event: "token"; data: ChatTokenEvent }
  | { event: "reasoning_token"; data: ChatReasoningTokenEvent }
  | { event: "reasoning_done"; data: ChatReasoningDoneEvent }
  | { event: "tool_call_start"; data: ChatToolCallStartEvent }
  | { event: "tool_call_end"; data: ChatToolCallEndEvent }
  | { event: "preview"; data: ChatPreviewEvent }
  | { event: "error"; data: ChatErrorEvent }
  | { event: "done"; data: ChatDoneEvent };

export type ChatSseEventName = ChatSseEvent["event"];
