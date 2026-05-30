import type OpenAI from "openai";
import type { ResolvedModel } from "../client";

// Single chat-completion turn against any LLM provider. The adapter accepts
// the canonical OpenAI message/tool shape used everywhere else in the
// codebase (history loading, dispatch planning, message building all assume
// it) and returns the same shape, adapters that talk to native APIs do the
// conversion internally so streamExecutor and runAgent never see Anthropic
// or Gemini-specific types.
//
// Streaming is the only mode: token deltas are forwarded via onTokenDelta as
// they arrive. the adapter returns the fully accumulated message + tool calls
// + usage when the upstream stream ends. Non-streaming callers (runAgent)
// just leave onTokenDelta unset and use the returned result directly.

export interface AdapterRequest {
  model: ResolvedModel;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  signal?: AbortSignal;
  onTokenDelta?: (text: string) => void;
  /** Pre-resolved provider API key. */
  apiKey?: string | null;
}

export interface AdapterResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  usage: { input: number; output: number };
  finishReason: string | null;
}

export interface ProviderAdapter {
  readonly kind: "openai_compat" | "anthropic" | "gemini";
  stream(req: AdapterRequest): Promise<AdapterResult>;
}
