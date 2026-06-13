import { prisma } from "@internal/db";
import {
  getSetting,
  isProviderReady,
  providerHasStoredKey,
  providerKindFromProvider,
  resolveProviderApiKey,
  selectAdapter,
  type ResolvedModel,
} from "@internal/llm-core";
import type { ChatSseEvent } from "@internal/shared-types";

// Two-stage image pipeline: a dedicated vision model turns attachments into text before the chat model runs.

const VISION_MODEL_KEY = "chat.visionModelId";
const MAX_EXTRACTED_CHARS = 4000;

export const EXTRACT_TOOL_NAME = "extract_image_text";

const EXTRACTION_INSTRUCTIONS =
  "You are an image transcription engine. Transcribe all visible text in the image verbatim, preserving structure such as lists, labels and table rows. After the transcription, add one short paragraph describing any non-text content (UI layout, diagrams, charts, photos). Output plain text only, no markdown fences.";

export interface PendingAttachment {
  dataUrl: string;
  mimeType: string;
}

export async function resolveVisionModel(): Promise<ResolvedModel | null> {
  const modelId = await getSetting<string>(VISION_MODEL_KEY);
  if (!modelId) return null;
  const model = await prisma.llmModel.findUnique({
    where: { id: modelId },
    include: { provider: true },
  });
  if (!model || !model.enabled || !model.provider.enabled || !model.supportsVision) return null;
  const hasStoredKey = await providerHasStoredKey(model.provider.id);
  if (!isProviderReady(model.provider, hasStoredKey)) return null;
  return model as ResolvedModel;
}

export async function visionReady(): Promise<boolean> {
  return (await resolveVisionModel()) !== null;
}

export interface ExtractArgs {
  attachments: PendingAttachment[];
  isAdmin: boolean;
  signal?: AbortSignal;
  onEvent: (e: ChatSseEvent) => void;
}

// Returns one entry per attachment, null when that image could not be read. Only an abort is rethrown.
export async function extractAttachmentTexts(args: ExtractArgs): Promise<(string | null)[]> {
  const model = await resolveVisionModel();
  args.onEvent({
    event: "tool_call_start",
    data: { id: "extract_0", name: EXTRACT_TOOL_NAME, args: { images: args.attachments.length } },
  });
  if (!model) {
    args.onEvent({
      event: "tool_call_end",
      data: {
        id: "extract_0",
        name: EXTRACT_TOOL_NAME,
        error: { message: "No vision model configured" },
      },
    });
    return args.attachments.map(() => null);
  }

  const apiKey = await resolveProviderApiKey({
    providerId: model.provider.id,
    providerSlug: model.provider.slug,
    apiKeyEnvVar: model.provider.apiKeyEnvVar,
    isAdmin: args.isAdmin,
  });
  const adapter = selectAdapter(providerKindFromProvider(model.provider));

  const results: (string | null)[] = [];
  let lastError: string | null = null;
  // Sequential calls, local vision models handle concurrent requests poorly.
  for (const att of args.attachments) {
    try {
      const turn = await adapter.stream({
        model,
        messages: [
          { role: "system", content: EXTRACTION_INSTRUCTIONS },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the content of this image." },
              { type: "image_url", image_url: { url: att.dataUrl } },
            ],
          },
        ],
        signal: args.signal,
        apiKey,
        temperature: 0,
      });
      const raw = typeof turn.message.content === "string" ? turn.message.content : "";
      // Some local VL models wrap output in think tags, strip them before use.
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      results.push(text ? text.slice(0, MAX_EXTRACTED_CHARS) : null);
    } catch (err) {
      if (args.signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      results.push(null);
    }
  }

  const okCount = results.filter((r) => r !== null).length;
  if (okCount === 0) {
    const detail = lastError ? `: ${lastError.slice(0, 300)}` : "";
    args.onEvent({
      event: "tool_call_end",
      data: {
        id: "extract_0",
        name: EXTRACT_TOOL_NAME,
        error: { message: `Text extraction failed for all images${detail}` },
      },
    });
  } else {
    args.onEvent({
      event: "tool_call_end",
      data: {
        id: "extract_0",
        name: EXTRACT_TOOL_NAME,
        result: {
          images: args.attachments.length,
          extracted: results.map((r) =>
            r ? (r.length > 200 ? `${r.slice(0, 200)}...` : r) : "(failed)",
          ),
        },
      },
    });
  }
  return results;
}

// Single source of truth for how extracted text rides along with the user text, used for the live turn and history replay.
export function composeUserContent(
  content: string,
  attachments: { extractedText: string | null }[],
): string {
  if (attachments.length === 0) return content;
  const blocks = attachments.map((a, i) =>
    a.extractedText
      ? `[Image ${i + 1} attached. Extracted content:]\n${a.extractedText}`
      : `[Image ${i + 1} attached, text extraction failed]`,
  );
  return [content.trim(), ...blocks].filter(Boolean).join("\n\n");
}
