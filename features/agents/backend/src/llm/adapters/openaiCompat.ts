import OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Per-model sampling defaults. Different families have very different
// "well-behaved" temperatures and there is no universal good value:
//   - Qwen 2.5 7B narrates fake tool results at default temp (~0.8); 0.2 forces
//     it to follow function-calling cues. The system prompt and hallucination
//     retry loop in streamExecutor were both built around this.
//   - Qwen3 thinking-mode is the opposite: Qwen team explicitly warns that low
//     temps cause reasoning loops and repetition. Their guidance is temp=0.6,
//     top_p=0.95 for thinking mode.
//   - gpt-oss reasoning models prefer ~1.0 per OpenAI's own guidance.
//   - Hosted frontier models (Claude, GPT-4o) tolerate 0.2 fine but it's not
//     ideal; treat that as a fallback, not a target.
function samplingDefaults(modelSlug: string): { temperature: number; topP?: number } {
  if (modelSlug.startsWith("qwen3-")) return { temperature: 0.6, topP: 0.95 };
  if (modelSlug.startsWith("gpt-oss-")) return { temperature: 1.0 };
  // Qwen 2.5 and unknown models keep the legacy babysitting value.
  return { temperature: 0.2 };
}

// OpenAI-compatible adapter. Covers OpenAI proper, Ollama (local),
// vLLM, llama.cpp's OpenAI-compat server, and Anthropic's OpenAI-compat
// shim — anything that speaks the chat.completions wire format. Provider
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

    const stream = await client.chat.completions.create(
      {
        model: req.model.modelName,
        messages: req.messages,
        tools: req.tools,
        // tool_choice "auto" is the default but spelling it out forces some
        // OpenAI-compat servers (Ollama in particular) to actually expose the
        // tool surface to the model. Without it, smaller models like Qwen
        // 2.5 7B sometimes treat tools as descriptive prose and ask the user
        // to invoke them instead of emitting a tool_call.
        tool_choice: req.tools && req.tools.length > 0 ? "auto" : undefined,
        temperature: sampling.temperature,
        ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
        // Allow callers to force tool_choice (the hallucination guard rail
        // does this with "required" after detecting a text-only action claim).
        ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: req.signal },
    );

    let content = "";
    let finishReason: string | null = null;
    const toolCallAccum: Map<number, { id?: string; name?: string; arguments: string }> = new Map();
    let usageInput = 0;
    let usageOutput = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice) {
        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          req.onTokenDelta?.(delta.content);
        }
        if (delta?.tool_calls) {
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
