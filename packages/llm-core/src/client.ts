import OpenAI from "openai";
import type { LlmModel, LlmProvider } from "@internal/db";

// OpenAI-SDK chat client used by the legacy non-streaming path, plus token-cost helper.

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

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const client = buildClient(req.model.provider);
  const res = await client.chat.completions.create(
    {
      model: req.model.modelName,
      messages: req.messages,
      tools: req.tools,
      max_tokens: req.maxTokens,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
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
    apiKey = "ollama";
  }
  return new OpenAI({ baseURL: provider.baseUrl, apiKey });
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
