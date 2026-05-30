import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Native Anthropic adapter using @anthropic-ai/sdk. Talks to api.anthropic.com
// directly (or any /v1/ endpoint configured by the LlmProvider's baseUrl) so
// we get prompt caching, native tool-use blocks, and the usage metadata that
// the OpenAI-compat shim drops.
//
// The adapter takes OpenAI-shaped messages/tools on the way in and returns
// OpenAI-shaped tool calls + usage on the way out, so streamExecutor and
// runAgent stay model-agnostic. Conversion is straightforward, the only
// non-obvious bit is that Anthropic puts the system prompt in a top-level
// `system` field rather than as a "role: system" message, and tool calls
// arrive as `tool_use` content blocks rather than as a separate field.

interface AnthropicTextBlockDelta {
  type: "text_delta";
  text: string;
}

interface AnthropicInputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

class AnthropicAdapter implements ProviderAdapter {
  readonly kind = "anthropic" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    // Prefer the caller-resolved key (per-agent Secret override) and fall
    // back to the env var named on LlmProvider.apiKeyEnvVar.
    const apiKey =
      req.apiKey ?? (provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : null);
    if (!apiKey) {
      throw new Error(
        `Missing API key for provider '${provider.slug}' (no Secret attached and env var ${provider.apiKeyEnvVar ?? "ANTHROPIC_API_KEY"} is unset)`,
      );
    }
    const client = new Anthropic({
      apiKey,
      // baseUrl override for self-hosted Anthropic-compat endpoints (rare, but
      // some platforms proxy Anthropic through their own gateway).
      baseURL: provider.baseUrl?.endsWith("/v1/")
        ? provider.baseUrl.slice(0, -1)
        : provider.baseUrl,
    });

    const { system, messages } = convertMessagesToAnthropic(req.messages);
    const tools = req.tools ? convertToolsToAnthropic(req.tools) : undefined;
    const toolChoice = mapToolChoiceToAnthropic(req.toolChoice, tools !== undefined);

    let content = "";
    // Map of tool_use block index -> accumulating tool call. Anthropic emits a
    // content_block_start with input={} then a series of input_json_delta
    // chunks. we concatenate the partial_json strings into final arguments.
    const toolUseAccum = new Map<number, { id: string; name: string; arguments: string }>();
    let usageInput = 0;
    let usageOutput = 0;
    let stopReason: string | null = null;

    // Anthropic requires max_tokens. Use the model's contextWindow as a
    // generous upper bound (clamped to a sensible max so a giant context
    // window doesn't translate to a giant generation budget).
    const maxTokens = Math.min(req.model.contextWindow, 8192);

    const stream = client.messages.stream(
      {
        model: req.model.modelName,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        tool_choice: toolChoice,
        // Mirror the openaiCompat adapter's low temperature for tool-call
        // reliability. Larger Anthropic models tolerate higher temps but
        // 0.2 keeps behavior consistent across providers.
        temperature: 0.2,
      },
      { signal: req.signal },
    );

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolUseAccum.set(event.index, {
              id: block.id,
              name: block.name,
              arguments: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta as AnthropicTextBlockDelta | AnthropicInputJsonDelta;
          if (delta.type === "text_delta") {
            content += delta.text;
            req.onTokenDelta?.(delta.text);
          } else if (delta.type === "input_json_delta") {
            const acc = toolUseAccum.get(event.index);
            if (acc) acc.arguments += delta.partial_json;
          }
          break;
        }
        case "message_delta": {
          // Final usage + stop_reason arrive on the message_delta event.
          const usage = event.usage;
          if (usage?.input_tokens != null) usageInput = usage.input_tokens;
          if (usage?.output_tokens != null) usageOutput = usage.output_tokens;
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
          break;
        }
        case "message_start": {
          // Initial usage snapshot, input_tokens are reported here.
          const usage = event.message.usage;
          if (usage?.input_tokens != null) usageInput = usage.input_tokens;
          if (usage?.output_tokens != null) usageOutput = usage.output_tokens;
          break;
        }
        default:
          // ping, content_block_stop, message_stop, nothing to do.
          break;
      }
    }

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];
    for (const [, acc] of toolUseAccum) {
      // Anthropic occasionally sends an empty input object as `input: {}`
      // without any input_json_delta events when the tool takes no args.
      // Default to "{}" so JSON.parse downstream doesn't choke.
      const args = acc.arguments || "{}";
      toolCalls.push({
        id: acc.id,
        type: "function",
        function: { name: acc.name, arguments: args },
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
      // Map Anthropic stop_reason to OpenAI finish_reason so streamExecutor's
      // existing branching ("if finishReason !== 'tool_calls' break") works.
      finishReason: mapStopReasonToOpenAi(stopReason, toolCalls.length > 0),
    };
  }
}

export const anthropicAdapter: ProviderAdapter = new AnthropicAdapter();

// Conversion helpers

interface AnthropicConvertedMessages {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
}

/** OpenAI puts the system prompt(s) in the messages array. Anthropic wants them as a separate */
function convertMessagesToAnthropic(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): AnthropicConvertedMessages {
  const systemParts: string[] = [];
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === "text") systemParts.push(part.text);
        }
      }
      continue;
    }

    if (m.role === "user") {
      const content =
        typeof m.content === "string"
          ? m.content
          : (m.content ?? []).flatMap((p) =>
              p.type === "text" ? [{ type: "text" as const, text: p.text }] : [],
            );
      out.push({ role: "user", content: content as Anthropic.MessageParam["content"] });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (typeof m.content === "string" && m.content.length > 0) {
        blocks.push({ type: "text", text: m.content });
      }
      // OpenAI represents tool calls as a separate `tool_calls` array on the
      // assistant message. Anthropic represents them as inline `tool_use`
      // content blocks. Convert each.
      const toolCalls = (
        m as { tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] }
      ).tool_calls;
      if (toolCalls) {
        for (const tc of toolCalls) {
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = tc.function.arguments
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            // If args aren't JSON (rare) pass them as a single string field
            // so the model still has something to read.
            parsedInput = { _raw: tc.function.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }
      if (blocks.length > 0) {
        out.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    if (m.role === "tool") {
      // Tool results in Anthropic land are user-role messages with a
      // tool_result block referencing the original tool_use_id. The OpenAI
      // shape carries the result as a string on `m.content`.
      const resultText = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: resultText,
          },
        ],
      });
      continue;
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

/** OpenAI tools nest the schema under `function: { parameters }`. Anthropic flattens to */
function convertToolsToAnthropic(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): Anthropic.Tool[] {
  return tools.flatMap((t) => {
    if (t.type !== "function") return [];
    const fn = t.function;
    return [
      {
        name: fn.name,
        description: fn.description ?? "",
        input_schema: (fn.parameters ?? {
          type: "object",
          properties: {},
        }) as Anthropic.Tool.InputSchema,
      },
    ];
  });
}

function mapToolChoiceToAnthropic(
  choice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
  hasTools: boolean,
): Anthropic.MessageCreateParams["tool_choice"] {
  if (!hasTools) return undefined;
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return undefined; // Anthropic has no "none". omitting tool_choice + tools={} skips
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function mapStopReasonToOpenAi(stop: string | null, hadToolCalls: boolean): string | null {
  if (!stop) return hadToolCalls ? "tool_calls" : null;
  switch (stop) {
    case "tool_use":
      return "tool_calls";
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    default:
      return stop;
  }
}
