// Renders one chat message (user or assistant), wiring up reasoning, tool calls, attachments, and avatars.
import { useState } from "react";
import type { ChatAttachmentDto, ChatMessageDto } from "@internal/shared-types";
import { ProfileAvatar, AgentAvatar } from "@internal/shared-ui";
import { useTranslation } from "@internal/i18n";
import { ToolCallChip } from "./ToolCallChip";
import { ReasoningSection } from "./ReasoningSection";
import type { ChatToolCallView } from "./chatStream";

interface Props {
  message: ChatMessageDto | LiveAssistantMessage;
  liveCalls?: ChatToolCallView[];
  userName?: string;
  userAvatarUrl?: string | null;
  assistantName?: string;
  assistantAvatarUrl?: string | null;
}

export interface LiveAssistantMessage {
  id: "live";
  role: "assistant";
  content: string;
  // Empty until the first reasoning token arrives.
  reasoning?: string;
  // Client timestamp of the first reasoning token, used to tick the live counter.
  reasoningStartedAt?: number | null;
  // Server-reported total ms once reasoning ends, null while still reasoning.
  reasoningDurationMs?: number | null;
}

function isLive(m: Props["message"]): m is LiveAssistantMessage {
  return m.id === "live";
}

export function MessageBubble({
  message,
  liveCalls = [],
  userName,
  userAvatarUrl,
  assistantName,
  assistantAvatarUrl,
}: Props) {
  const { t } = useTranslation("chat");
  const isUser = message.role === "user";

  // Assistant reasoning comes from the live shape when present, else the persisted DTO.
  const reasoning = isLive(message)
    ? (message.reasoning ?? "")
    : !isUser
      ? ((message as ChatMessageDto).reasoning ?? "")
      : "";
  const reasoningStartedAt = isLive(message) ? (message.reasoningStartedAt ?? null) : null;
  const reasoningDurationMs = isLive(message)
    ? (message.reasoningDurationMs ?? null)
    : !isUser
      ? ((message as ChatMessageDto).reasoningDurationMs ?? null)
      : null;
  const hasReasoning = !isUser && (reasoning.length > 0 || reasoningStartedAt != null);
  const reasoningStreaming = isLive(message) && reasoningDurationMs == null;
  const attachments = isUser && !isLive(message) ? (message.attachments ?? []) : [];

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className="shrink-0 self-start pt-0.5">
        {isUser ? (
          <ProfileAvatar
            name={userName ?? t("message.youFallback")}
            avatarUrl={userAvatarUrl}
            size="sm"
          />
        ) : (
          <AgentAvatar
            name={assistantName ?? t("message.assistantFallback")}
            avatarUrl={assistantAvatarUrl}
            size={28}
          />
        )}
      </div>
      <div
        className={`max-w-[85%] rounded-app-lg px-3 py-2 text-sm sm:max-w-[80%] ${
          isUser
            ? "bg-app-primary-soft text-app-primary-soft-foreground"
            : "bg-app-surface text-app-text border border-app-border"
        }`}
      >
        {hasReasoning && (
          <ReasoningSection
            reasoning={reasoning}
            startedAt={reasoningStartedAt}
            durationMs={reasoningDurationMs}
            isStreaming={reasoningStreaming}
          />
        )}
        {!isUser && liveCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {liveCalls.map((c) => (
              <ToolCallChip key={c.id} call={c} />
            ))}
          </div>
        )}
        {!isUser && !isLive(message) && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.toolCalls.map((c, i) => (
              <ToolCallChip
                key={i}
                call={{
                  id: String(i),
                  name: c.name,
                  args: (c.input as Record<string, unknown>) ?? {},
                  result: c.output,
                  error: c.isError ? String(c.output) : undefined,
                  done: true,
                }}
              />
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${message.content ? "mb-2" : ""}`}>
            {attachments.map((a, i) => (
              <AttachmentImage key={i} attachment={a} index={i} />
            ))}
          </div>
        )}
        {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
      </div>
    </div>
  );
}

function AttachmentImage({ attachment, index }: { attachment: ChatAttachmentDto; index: number }) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  return (
    <img
      src={attachment.dataUrl}
      alt={t("message.imageAlt", { index: index + 1 })}
      onClick={() => setExpanded((v) => !v)}
      className={`max-w-full rounded-app-md border border-app-border object-contain ${
        expanded ? "max-h-96 cursor-zoom-out" : "h-24 cursor-zoom-in"
      }`}
    />
  );
}
