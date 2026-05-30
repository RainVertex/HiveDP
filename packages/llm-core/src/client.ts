import OpenAI from "openai";
import type { LlmModel, LlmProvider } from "@internal/db";

export type ResolvedModel = LlmModel & { provider: LlmProvider };

export interface ChatRequest {
  model: ResolvedModel;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  // Narrowed to function-shape calls. we don't currently emit custom tools.
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  usage: { input: number; output: number };
  finishReason: string | null;
}

// Single chat-completion turn against a registered provider/model. Every
// provider, Ollama, OpenAI, Anthropic-via-its-OpenAI-compat-endpoint, is
// reached through the OpenAI SDK. only baseUrl + the optional env-var-backed
// API key differ. The caller drives the agentic loop (see runAgent).
export async function chat(req: ChatRequest): Promise<ChatResult> {
  const client = buildClient(req.model.provider);
  const res = await client.chat.completions.create(
    {
      model: req.model.modelName,
      messages: req.messages,
      tools: req.tools,
      max_tokens: req.maxTokens,
    },
    { signal: req.signal },
  );
  const choice = res.choices[0];
  if (!choice) {
    throw new Error("Provider returned no choices");
  }
  const toolCalls = (choice.message.tool_calls ?? []).filter(
    (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
      tc.type === "function",
  );
  return {
    message: choice.message,
    toolCalls,
    usage: {
      input: res.usage?.prompt_tokens ?? 0,
      output: res.usage?.completion_tokens ?? 0,
    },
    finishReason: choice.finish_reason ?? null,
  };
}

function buildClient(provider: LlmProvider): OpenAI {
  let apiKey: string;
  if (provider.apiKeyEnvVar) {
    const fromEnv = process.env[provider.apiKeyEnvVar];
    if (!fromEnv) {
      throw new Error(
        `Missing env var ${provider.apiKeyEnvVar} required by provider '${provider.slug}'`,
      );
    }
    apiKey = fromEnv;
  } else {
    // Provider explicitly requires no key (e.g. Ollama). The OpenAI SDK still
    // requires a non-empty string. the upstream just ignores it.
    apiKey = "ollama";
  }
  return new OpenAI({ baseURL: provider.baseUrl, apiKey });
}

// Compute USD cost from token usage and the model's per-1k rates. Returns
// null if either rate is unset (e.g. local Ollama models).
export function computeCostUsd(
  model: ResolvedModel,
  usage: { input: number; output: number },
): number | null {
  if (model.costPer1kIn == null || model.costPer1kOut == null) return null;
  const inRate = Number(model.costPer1kIn);
  const outRate = Number(model.costPer1kOut);
  return (usage.input / 1000) * inRate + (usage.output / 1000) * outRate;
}
