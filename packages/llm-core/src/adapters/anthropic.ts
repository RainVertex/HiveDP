import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Native Anthropic streaming adapter; converts to/from the OpenAI message/tool shape.

interface AnthropicTextBlockDelta {
  type: "text_delta";
  text: string;
}

interface AnthropicInputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

interface AnthropicThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

class AnthropicAdapter implements ProviderAdapter {
  readonly kind = "anthropic" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    const apiKey =
      req.apiKey ?? (provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : null);
    if (!apiKey) {
      throw new Error(
        `Missing API key for provider '${provider.slug}' (no Secret attached and env var ${provider.apiKeyEnvVar ?? "ANTHROPIC_API_KEY"} is unset)`,
      );
    }
    const client = new Anthropic({
      apiKey,
      baseURL: provider.baseUrl?.endsWith("/v1/")
        ? provider.baseUrl.slice(0, -1)
        : provider.baseUrl,
    });

    const { system, messages } = convertMessagesToAnthropic(req.messages);
    const tools = req.tools ? convertToolsToAnthropic(req.tools) : undefined;
    const toolChoice = mapToolChoiceToAnthropic(req.toolChoice, tools !== undefined);

    let content = "";
    let reasoning = "";
    const toolUseAccum = new Map<number, { id: string; name: string; arguments: string }>();
    let usageInput = 0;
    let usageOutput = 0;
    let stopReason: string | null = null;

    const maxTokens = Math.min(req.model.contextWindow, 8192);

    const stream = client.messages.stream(
      {
        model: req.model.modelName,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: req.temperature ?? 0.2,
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
          const delta = event.delta as
            | AnthropicTextBlockDelta
            | AnthropicInputJsonDelta
            | AnthropicThinkingDelta;
          if (delta.type === "text_delta") {
            content += delta.text;
            req.onTokenDelta?.(delta.text);
          } else if (delta.type === "thinking_delta") {
            reasoning += delta.thinking;
          } else if (delta.type === "input_json_delta") {
            const acc = toolUseAccum.get(event.index);
            if (acc) acc.arguments += delta.partial_json;
          }
          break;
        }
        case "message_delta": {
          const usage = event.usage;
          if (usage?.input_tokens != null) usageInput = usage.input_tokens;
          if (usage?.output_tokens != null) usageOutput = usage.output_tokens;
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
          break;
        }
        case "message_start": {
          const usage = event.message.usage;
          if (usage?.input_tokens != null) usageInput = usage.input_tokens;
          if (usage?.output_tokens != null) usageOutput = usage.output_tokens;
          break;
        }
        default:
          break;
      }
    }

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];
    for (const [, acc] of toolUseAccum) {
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
      finishReason: mapStopReasonToOpenAi(stopReason, toolCalls.length > 0),
      reasoning: reasoning || null,
    };
  }
}

export const anthropicAdapter: ProviderAdapter = new AnthropicAdapter();

interface AnthropicConvertedMessages {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
}

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
  if (choice === "none") return undefined;
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
