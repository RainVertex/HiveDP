import OpenAI from "openai";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Native OpenAI Responses API adapter. Converts to/from the OpenAI chat message/tool shape and
// streams reasoning summaries (o-series / GPT-5) as <think> blocks so the chat splitter surfaces
// them. Used only for the official OpenAI provider; Ollama/vLLM stay on openai_compat.

class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly kind = "openai_responses" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    const apiKey = req.apiKey;
    if (!apiKey) {
      throw new Error(
        `Missing API key for provider '${provider.slug}' (add one in Admin -> AI / Models)`,
      );
    }
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey });

    const { instructions, input } = convertMessagesToResponses(req.messages);
    const tools = req.tools ? convertToolsToResponses(req.tools) : [];
    const toolChoice = mapToolChoiceToResponses(req.toolChoice, tools.length > 0);
    const reasoningModel = req.model.supportsReasoning;
    // Reasoning models reject a non-default temperature; only sample-control the others.
    const temperature = reasoningModel ? undefined : (req.temperature ?? 0.2);

    let content = "";
    let reasoning = "";
    let usageInput = 0;
    let usageOutput = 0;
    let status: string | null = null;
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];

    // The chat splitter reads reasoning out of <think> markers, mirror the openai_compat adapter.
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

    const stream = await client.responses.create(
      {
        model: req.model.modelName,
        input,
        ...(instructions ? { instructions } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...(reasoningModel ? { reasoning: { summary: "detailed" } } : {}),
        ...(temperature != null ? { temperature } : {}),
        // Stateless: the chat loop replays the full message history each turn, so we never rely on
        // OpenAI-side storage (and avoid retaining conversation data on their servers).
        store: false,
        stream: true,
      },
      { signal: req.signal },
    );

    for await (const event of stream as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>) {
      switch (event.type) {
        case "response.reasoning_summary_text.delta": {
          if (event.delta) {
            openTag();
            reasoning += event.delta;
            req.onTokenDelta?.(event.delta);
          }
          break;
        }
        case "response.output_text.delta": {
          if (event.delta) {
            closeTag();
            content += event.delta;
            req.onTokenDelta?.(event.delta);
          }
          break;
        }
        case "response.refusal.delta": {
          // Surface a refusal as assistant text so it is not silently dropped (the result shape has
          // a refusal field but the chat loop only renders content).
          if (event.delta) {
            closeTag();
            content += event.delta;
            req.onTokenDelta?.(event.delta);
          }
          break;
        }
        case "response.output_item.done": {
          const item = event.item;
          if (item.type === "function_call") {
            closeTag();
            toolCalls.push({
              id: item.call_id,
              type: "function",
              function: { name: item.name, arguments: item.arguments || "{}" },
            });
          }
          break;
        }
        case "response.completed":
        case "response.incomplete": {
          status = event.response.status ?? null;
          const usage = event.response.usage;
          if (usage) {
            usageInput = usage.input_tokens ?? 0;
            usageOutput = usage.output_tokens ?? 0;
          }
          break;
        }
        case "response.failed": {
          throw new Error(event.response.error?.message ?? "OpenAI Responses request failed");
        }
        case "error": {
          throw new Error(event.message ?? "OpenAI Responses stream error");
        }
        default:
          break;
      }
    }
    closeTag();

    const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content: content || null,
      refusal: null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    // Truncation wins over tool calls: an incomplete response may carry half-built tool-call args,
    // so report "length" rather than looping the executor on a cut-off call.
    const finishReason =
      status === "incomplete" ? "length" : toolCalls.length > 0 ? "tool_calls" : "stop";

    return {
      message,
      toolCalls,
      usage: { input: usageInput, output: usageOutput },
      finishReason,
      reasoning: reasoning || null,
    };
  }
}

export const openaiResponsesAdapter: ProviderAdapter = new OpenAIResponsesAdapter();

interface ResponsesConvertedMessages {
  instructions: string | undefined;
  input: OpenAI.Responses.ResponseInputItem[];
}

// System messages collapse into `instructions`, assistant tool calls become function_call items, and
// tool results become function_call_output items, keyed by the same call_id the chat loop round-trips.
function convertMessagesToResponses(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): ResponsesConvertedMessages {
  const systemParts: string[] = [];
  const input: OpenAI.Responses.ResponseInputItem[] = [];

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
      if (typeof m.content === "string") {
        input.push({ role: "user", content: m.content });
      } else {
        const parts = (m.content ?? []).flatMap((p): OpenAI.Responses.ResponseInputContent[] => {
          if (p.type === "text") return [{ type: "input_text", text: p.text }];
          if (p.type === "image_url") {
            return [{ type: "input_image", image_url: p.image_url.url, detail: "auto" }];
          }
          return [];
        });
        input.push({ role: "user", content: parts });
      }
      continue;
    }

    if (m.role === "assistant") {
      if (typeof m.content === "string" && m.content.length > 0) {
        input.push({ role: "assistant", content: m.content });
      }
      const toolCalls = (
        m as { tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] }
      ).tool_calls;
      if (toolCalls) {
        for (const tc of toolCalls) {
          input.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments || "{}",
          });
        }
      }
      continue;
    }

    if (m.role === "tool") {
      const output = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output });
      continue;
    }
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    input,
  };
}

function convertToolsToResponses(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): OpenAI.Responses.FunctionTool[] {
  return tools.flatMap((t) => {
    if (t.type !== "function") return [];
    const fn = t.function;
    return [
      {
        type: "function",
        name: fn.name,
        description: fn.description ?? "",
        parameters: (fn.parameters ?? { type: "object", properties: {} }) as Record<
          string,
          unknown
        >,
        // Honor the caller's strict flag, default off so existing non-strict tool schemas keep working.
        strict: fn.strict ?? false,
      },
    ];
  });
}

function mapToolChoiceToResponses(
  choice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
  hasTools: boolean,
): OpenAI.Responses.ResponseCreateParams["tool_choice"] | undefined {
  if (!hasTools || !choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "function", name: choice.function.name };
  }
  return undefined;
}
