import type OpenAI from "openai";
import type { LlmModel, LlmProvider } from "@internal/db";

// Resolved-model shape, the chat request/result types shared with the agent loop, and a token-cost helper.

export type ResolvedModel = LlmModel & { provider: LlmProvider };

// Provider SDKs retry 429/5xx with backoff and honor Retry-After. The default of 2 is too low for a
// low-TPM model on a multi-step agent run (a transient "try again in 2s" rate limit fails the whole
// run), so raise it. Tunable via env.
export const LLM_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 5);

export interface ChatRequest {
  model: ResolvedModel;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
  signal?: AbortSignal;
  temperature?: number | null;
}

// `input` is the total input token count (cached tokens included); cacheRead/cacheWrite carry the
// cached subset so cost can price them at the cheaper cache rates instead of the full input rate.
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  usage: TokenUsage;
  finishReason: string | null;
  reasoning?: string | null;
}

export function computeCostUsd(
  model: ResolvedModel,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number | null {
  if (model.costPer1kIn == null || model.costPer1kOut == null) return null;
  const inRate = Number(model.costPer1kIn);
  const outRate = Number(model.costPer1kOut);
  // Cache rates fall back to the base input rate when a model has none, so an unpriced cache never
  // undercharges (it just costs the same as fresh input, which is what we billed before).
  const readRate = model.costPer1kCacheRead != null ? Number(model.costPer1kCacheRead) : inRate;
  const writeRate = model.costPer1kCacheWrite != null ? Number(model.costPer1kCacheWrite) : inRate;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const freshInput = Math.max(0, usage.input - cacheRead - cacheWrite);
  return (
    (freshInput / 1000) * inRate +
    (cacheRead / 1000) * readRate +
    (cacheWrite / 1000) * writeRate +
    (usage.output / 1000) * outRate
  );
}
