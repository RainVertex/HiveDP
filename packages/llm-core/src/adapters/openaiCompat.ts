import OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Per-model sampling defaults. Different families have very different
// "well-behaved" temperatures and there is no universal good value:
// - Qwen3 thinking-mode: Qwen team's guidance is temp=0.6, top_p=0.95. Lower
// temps trigger reasoning loops and repetition.
// - gpt-oss reasoning models: ~1.0 per OpenAI's guidance.
// Add a branch here when registering a new family, don't rely on the fallback.
function samplingDefaults(modelSlug: string): { temperature: number; topP?: number } {
  if (modelSlug.startsWith("qwen3-")) return { temperature: 0.6, topP: 0.95 };
  if (modelSlug.startsWith("gpt-oss-")) return { temperature: 1.0 };
  // Conservative default for models without explicit guidance.
  return { temperature: 0.2 };
}

// OpenAI-compatible adapter. Covers OpenAI proper, Ollama (local)
// vLLM, llama.cpp's OpenAI-compat server, and Anthropic's OpenAI-compat
// shim, anything that speaks the chat.completions wire format. Provider
// is differentiated solely by baseUrl + the optional env-var-referenced
// API key on the LlmProvider row.
//
// The implementation here is a verbatim port of the streaming logic that
// previously lived inline in features/chat/backend/src/streamExecutor.ts
// (function streamChat). Centralizing it behind the ProviderAdapter
// interface lets the streamExecutor stay model-agnostic.

class OpenAICompatAdapter implements ProviderAdapter {
  readonly kind = "openai_compat" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    // Prefer the caller-resolved key (lets per-agent Secret overrides win)
    // and fall back to the env-var pattern that LlmProvider.apiKeyEnvVar
    // points at. Ollama and other no-auth servers leave apiKeyEnvVar null
    // and the OpenAI SDK happily accepts the dummy "ollama" string.
    let apiKey: string | null | undefined = req.apiKey;
    if (apiKey === undefined) {
      apiKey = provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : "ollama";
      if (provider.apiKeyEnvVar && !apiKey) {
        throw new Error(
          `Missing env var ${provider.apiKeyEnvVar} required by provider '${provider.slug}'`,
        );
      }
    }
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey: apiKey ?? "ollama" });

    const sampling = samplingDefaults(req.model.slug);
    // Qwen3 thinking is a per-request soft switch. Ollama's chat template
    // defaults to non-thinking for `qwen3:*` over the OpenAI-compat endpoint
    // so we have to opt in explicitly or the model never emits `<think>` tags
    // and the chat UI's reasoning panel stays hidden. Send both spellings:
    // - `chat_template_kwargs: { enable_thinking: true }`, vLLM/SGLang
    // - `think: true`, Ollama 0.9+ native body field
    // Unknown body fields are silently ignored by each backend, so sending
    // both is safe regardless of which one the live server speaks.
    const isQwen3 = req.model.slug.startsWith("qwen3-");
    // Forwarded as-is by the OpenAI SDK to the upstream backend. Cast through
    // an empty object literal so the rest of the create() args keep their
    // strict typing (which the SDK relies on to pick the streaming overload).
    const qwen3ThinkingExtras = isQwen3
      ? ({ chat_template_kwargs: { enable_thinking: true }, think: true } as object)
      : {};

    const stream = await client.chat.completions.create(
      {
        model: req.model.modelName,
        messages: req.messages,
        tools: req.tools,
        // tool_choice "auto" is the default but spelling it out forces some
        // OpenAI-compat servers (Ollama in particular) to actually expose the
        // tool surface to the model. Without it, smaller local models
        // sometimes treat tools as descriptive prose and ask the user to
        // invoke them instead of emitting a tool_call.
        tool_choice: req.tools && req.tools.length > 0 ? "auto" : undefined,
        temperature: sampling.temperature,
        ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
        // Callers can force tool_choice (e.g. "required") to override the
        // default auto for a specific turn.
        ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
        stream: true,
        stream_options: { include_usage: true },
        ...qwen3ThinkingExtras,
      },
      { signal: req.signal },
    );

    let content = "";
    let finishReason: string | null = null;
    const toolCallAccum: Map<number, { id?: string; name?: string; arguments: string }> = new Map();
    let usageInput = 0;
    let usageOutput = 0;

    // Some backends emit reasoning on a SEPARATE delta channel rather than
    // inline as `<think>...</think>` inside `delta.content`. Field names vary:
    // - Ollama 0.9+ with `think: true` → `delta.thinking`
    // - DeepSeek-R1 / SGLang → `delta.reasoning_content`
    // - OpenAI reasoning models → `delta.reasoning`
    // To keep the downstream pipeline simple, we synthesize `<think>` / `</think>`
    // markers around runs of reasoning chunks and forward everything via the
    // same onTokenDelta. The ThinkTagSplitter on the receiving side then routes
    // them to the reasoning channel exactly as if they had been emitted inline.
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
    // Close any still-open `<think>` so the splitter stops timing reasoning
    // even if the stream ended mid-thought (rare, but possible on abort).
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
    };
  }
}

export const openaiCompatAdapter: ProviderAdapter = new OpenAICompatAdapter();
