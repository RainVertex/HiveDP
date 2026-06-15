import OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// OpenAI-compatible streaming adapter (OpenAI, Ollama, vLLM, llama.cpp, Anthropic shim), with per-family sampling defaults and reasoning-channel normalization.

function samplingDefaults(modelSlug: string): { temperature: number; topP?: number } {
  if (modelSlug.startsWith("qwen3-")) return { temperature: 0.6, topP: 0.95 };
  if (modelSlug.startsWith("gpt-oss-")) return { temperature: 1.0 };
  return { temperature: 0.2 };
}

class OpenAICompatAdapter implements ProviderAdapter {
  readonly kind = "openai_compat" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    let apiKey = req.apiKey ?? undefined;
    if (apiKey === undefined) {
      if (provider.apiKeyEnvVar) {
        throw new Error(
          `Missing API key for provider '${provider.slug}' (add one in Admin -> AI / Models)`,
        );
      }
      apiKey = "ollama";
    }
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey });

    const sampling = samplingDefaults(req.model.slug);
    const isQwen3 = req.model.slug.startsWith("qwen3-");
    const qwen3ThinkingExtras = isQwen3
      ? ({ chat_template_kwargs: { enable_thinking: true }, think: true } as object)
      : {};

    const stream = await client.chat.completions.create(
      {
        model: req.model.modelName,
        messages: req.messages,
        tools: req.tools,
        tool_choice: req.tools && req.tools.length > 0 ? "auto" : undefined,
        temperature: req.temperature ?? sampling.temperature,
        ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
        ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
        stream: true,
        stream_options: { include_usage: true },
        ...qwen3ThinkingExtras,
      },
      { signal: req.signal },
    );

    let content = "";
    let reasoning = "";
    let finishReason: string | null = null;
    const toolCallAccum: Map<number, { id?: string; name?: string; arguments: string }> = new Map();
    let usageInput = 0;
    let usageOutput = 0;

    let inThinking = false;
    const openTag = (): void => {
      if (inThinking) return;
      req.onTokenDelta?.("<think>");
      inThinking = true;
    };
    const closeTag = (): void => {
      if (!inThinking) return;
      req.onTokenDelta?.("</think>");
      inThinking = false;
    };

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice) {
        const delta = choice.delta as
          | (typeof choice.delta & {
              thinking?: string | null;
              reasoning_content?: string | null;
              reasoning?: string | null;
            })
          | undefined;
        const reasoningChunk = delta?.thinking ?? delta?.reasoning_content ?? delta?.reasoning;
        if (reasoningChunk) {
          openTag();
          reasoning += reasoningChunk;
          req.onTokenDelta?.(reasoningChunk);
        }
        if (delta?.content) {
          closeTag();
          content += delta.content;
          req.onTokenDelta?.(delta.content);
        }
        if (delta?.tool_calls) {
          closeTag();
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            const acc = toolCallAccum.get(idx) ?? { arguments: "" };
            if (tcDelta.id) acc.id = tcDelta.id;
            if (tcDelta.function?.name) acc.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
            toolCallAccum.set(idx, acc);
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usageInput = chunk.usage.prompt_tokens ?? 0;
        usageOutput = chunk.usage.completion_tokens ?? 0;
      }
    }
    closeTag();

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];
    for (const [, acc] of toolCallAccum) {
      if (!acc.id || !acc.name) continue;
      toolCalls.push({
        id: acc.id,
        type: "function",
        function: { name: acc.name, arguments: acc.arguments },
      });
    }

    const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content: content || null,
      refusal: null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      message,
      toolCalls,
      usage: { input: usageInput, output: usageOutput },
      finishReason,
      reasoning: reasoning || null,
    };
  }
}

export const openaiCompatAdapter: ProviderAdapter = new OpenAICompatAdapter();
