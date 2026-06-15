import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
  type Schema,
  type Tool,
  type ToolConfig,
} from "@google/genai";
import type OpenAI from "openai";
import { randomUUID } from "node:crypto";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "./providerAdapter";

// Native Gemini streaming adapter; converts to/from the OpenAI message/tool shape and mints synthetic tool-call ids.

class GeminiAdapter implements ProviderAdapter {
  readonly kind = "gemini" as const;

  async stream(req: AdapterRequest): Promise<AdapterResult> {
    const provider = req.model.provider;
    const apiKey = req.apiKey;
    if (!apiKey) {
      throw new Error(
        `Missing API key for provider '${provider.slug}' (add one in Admin -> AI / Models)`,
      );
    }
    const client = new GoogleGenAI({ apiKey });

    const { systemInstruction, contents } = convertMessagesToGemini(req.messages);
    const tools = req.tools ? convertToolsToGemini(req.tools) : undefined;
    const toolConfig = mapToolChoiceToGemini(req.toolChoice, tools !== undefined);

    let content = "";
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = [];
    let usageInput = 0;
    let usageOutput = 0;
    let finishReason: string | null = null;

    const stream = await client.models.generateContentStream({
      model: req.model.modelName,
      contents,
      config: {
        systemInstruction,
        tools,
        toolConfig,
        temperature: req.temperature ?? 0.2,
        abortSignal: req.signal,
      },
    });

    for await (const chunk of stream as AsyncIterable<GenerateContentResponse>) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          const p = part as Part;
          if (typeof p.text === "string" && p.text.length > 0) {
            content += p.text;
            req.onTokenDelta?.(p.text);
          }
          if (p.functionCall) {
            const fnName = p.functionCall.name ?? "unknown_tool";
            const args = p.functionCall.args ?? {};
            toolCalls.push({
              id: `call_${randomUUID()}`,
              type: "function",
              function: { name: fnName, arguments: JSON.stringify(args) },
            });
          }
        }
      }
      if (candidate?.finishReason) {
        finishReason = String(candidate.finishReason);
      }
      const usage = chunk.usageMetadata;
      if (usage) {
        if (typeof usage.promptTokenCount === "number") usageInput = usage.promptTokenCount;
        if (typeof usage.candidatesTokenCount === "number")
          usageOutput = usage.candidatesTokenCount;
      }
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
      finishReason: mapFinishReasonToOpenAi(finishReason, toolCalls.length > 0),
    };
  }
}

export const geminiAdapter: ProviderAdapter = new GeminiAdapter();

interface GeminiConvertedMessages {
  systemInstruction: string | undefined;
  contents: Content[];
}

function convertMessagesToGemini(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): GeminiConvertedMessages {
  const systemParts: string[] = [];
  const out: Content[] = [];

  const toolCallNames = new Map<string, string>();

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
        out.push({ role: "user", parts: [{ text: m.content } as Part] });
        continue;
      }
      const parts: Part[] = [];
      for (const p of m.content ?? []) {
        if (p.type === "text" && p.text) {
          parts.push({ text: p.text } as Part);
        } else if (p.type === "image_url") {
          const match = /^data:([^;,]+);base64,(.+)$/.exec(p.image_url.url);
          if (match) {
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } } as Part);
          }
        }
      }
      out.push({ role: "user", parts: parts.length > 0 ? parts : [{ text: "" } as Part] });
      continue;
    }

    if (m.role === "assistant") {
      const parts: Part[] = [];
      if (typeof m.content === "string" && m.content.length > 0) {
        parts.push({ text: m.content } as Part);
      }
      const toolCalls = (
        m as { tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] }
      ).tool_calls;
      if (toolCalls) {
        for (const tc of toolCalls) {
          toolCallNames.set(tc.id, tc.function.name);
          let args: Record<string, unknown>;
          try {
            args = tc.function.arguments
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            args = { _raw: tc.function.arguments };
          }
          parts.push({ functionCall: { name: tc.function.name, args } } as Part);
        }
      }
      if (parts.length > 0) {
        out.push({ role: "model", parts });
      }
      continue;
    }

    if (m.role === "tool") {
      const fnName = toolCallNames.get(m.tool_call_id) ?? m.tool_call_id;
      let response: Record<string, unknown>;
      try {
        const raw = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        const parsed: unknown = JSON.parse(raw);
        response =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        response = { result: m.content };
      }
      out.push({
        role: "user",
        parts: [{ functionResponse: { name: fnName, response } } as Part],
      });
      continue;
    }
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents: out,
  };
}

function convertToolsToGemini(tools: OpenAI.Chat.Completions.ChatCompletionTool[]): Tool[] {
  const fns: FunctionDeclaration[] = tools.flatMap((t) => {
    if (t.type !== "function") return [];
    return [
      {
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: (t.function.parameters ?? { type: "object", properties: {} }) as Schema,
      },
    ];
  });
  return fns.length > 0 ? [{ functionDeclarations: fns }] : [];
}

function mapToolChoiceToGemini(
  choice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
  hasTools: boolean,
): ToolConfig | undefined {
  if (!hasTools) return undefined;
  if (!choice || choice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } } as ToolConfig;
  }
  if (choice === "required") {
    return { functionCallingConfig: { mode: "ANY" } } as ToolConfig;
  }
  if (choice === "none") {
    return { functionCallingConfig: { mode: "NONE" } } as ToolConfig;
  }
  if (typeof choice === "object" && choice.type === "function") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [choice.function.name],
      },
    } as ToolConfig;
  }
  return undefined;
}

function mapFinishReasonToOpenAi(reason: string | null, hadToolCalls: boolean): string | null {
  if (!reason) return hadToolCalls ? "tool_calls" : null;
  switch (reason) {
    case "STOP":
      return hadToolCalls ? "tool_calls" : "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return reason.toLowerCase();
  }
}
