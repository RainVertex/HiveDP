// Wire types for the Platform Assistant chatbot. Shared between the backend
// streaming executor (which emits SSE events) and the frontend chatStream
// hook + components (which render them). Treat this file as the contract for
// /api/chat/conversations/:id/messages — changes here ripple to both sides.

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
  createdAt: ISODateString;
}

export interface ChatConversationSummaryDto {
  id: ID;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Last assistant message timestamp; used by the widget unread badge. */
  lastAssistantAt: ISODateString | null;
}

export interface ChatConversationDetailDto extends ChatConversationSummaryDto {
  messages: ChatMessageDto[];
}

// -----------------------------------------------------------------------------
// SSE event schema
// -----------------------------------------------------------------------------
// Each frame on the wire: `event: <type>\ndata: <json>\n\n`. The discriminator
// is the SSE event name; the data payload is the JSON shape below.

export interface ChatTokenEvent {
  text: string;
}

export interface ChatToolCallStartEvent {
  /** OpenAI tool_call id, used to pair start ↔ end. */
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

/** Emitted alongside the corresponding tool_call_end for any *_prepare tool. */
export interface ChatPreviewEvent {
  shortHandle: string;
  toolId: string;
  /** Server-authored, deterministic recap built from parsedParams. */
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
  /** True when this turn invoked any *_submit tool. */
  containsWrites: boolean;
}

export type ChatSseEvent =
  | { event: "token"; data: ChatTokenEvent }
  | { event: "tool_call_start"; data: ChatToolCallStartEvent }
  | { event: "tool_call_end"; data: ChatToolCallEndEvent }
  | { event: "preview"; data: ChatPreviewEvent }
  | { event: "error"; data: ChatErrorEvent }
  | { event: "done"; data: ChatDoneEvent };

export type ChatSseEventName = ChatSseEvent["event"];
