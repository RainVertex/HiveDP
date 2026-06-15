import type OpenAI from "openai";
import type { LlmModel, LlmProvider } from "@internal/db";

// Resolved-model shape, the chat request/result types shared with the agent loop, and a token-cost helper.

export type ResolvedModel = LlmModel & { provider: LlmProvider };

export interface ChatRequest {
  model: ResolvedModel;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
  signal?: AbortSignal;
  temperature?: number | null;
}

export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  usage: { input: number; output: number };
  finishReason: string | null;
  reasoning?: string | null;
}

export function computeCostUsd(
  model: ResolvedModel,
  usage: { input: number; output: number },
): number | null {
  if (model.costPer1kIn == null || model.costPer1kOut == null) return null;
  const inRate = Number(model.costPer1kIn);
  const outRate = Number(model.costPer1kOut);
  return (usage.input / 1000) * inRate + (usage.output / 1000) * outRate;
}
