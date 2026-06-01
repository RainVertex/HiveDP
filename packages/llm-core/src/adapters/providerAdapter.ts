import type OpenAI from "openai";
import type { ResolvedModel } from "../client";

// Streaming chat-turn interface in OpenAI message/tool shape; native adapters convert internally.

export interface AdapterRequest {
  model: ResolvedModel;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  signal?: AbortSignal;
  onTokenDelta?: (text: string) => void;
  apiKey?: string | null;
  temperature?: number | null;
}

export interface AdapterResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  usage: { input: number; output: number };
  finishReason: string | null;
  reasoning?: string | null;
}

export interface ProviderAdapter {
  readonly kind: "openai_compat" | "anthropic" | "gemini";
  stream(req: AdapterRequest): Promise<AdapterResult>;
}
