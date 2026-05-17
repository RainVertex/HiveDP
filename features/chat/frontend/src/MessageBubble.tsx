import type { ChatMessageDto, ChatPreviewEvent } from "@internal/shared-types";
import { ProfileAvatar } from "@internal/shared-ui";
import { ToolCallChip } from "./ToolCallChip";
import { PreviewCard } from "./PreviewCard";
import { ReasoningSection } from "./ReasoningSection";
import { AssistantAvatar } from "./AssistantAvatar";
import type { ChatToolCallView } from "./chatStream";

interface Props {
  message: ChatMessageDto | LiveAssistantMessage;
  previews?: ChatPreviewEvent[];
  liveCalls?: ChatToolCallView[];
  onConfirmPreview?: (preview: ChatPreviewEvent) => void;
  onCancelPreview?: (preview: ChatPreviewEvent) => void;
  /** Disable preview confirm/cancel buttons (e.g. */
  previewsDisabled?: boolean;
  /** Current user info, used to render the right-side avatar on user messages. */
  userName?: string;
  userAvatarUrl?: string | null;
}

export interface LiveAssistantMessage {
  id: "live";
  role: "assistant";
  content: string;
  /** Streaming `<think>` content; empty until the first reasoning token arrives. */
  reasoning?: string;
  /** Client-side timestamp of the first reasoning token, used to tick the live counter. */
  reasoningStartedAt?: number | null;
  /** Server-reported total ms once reasoning ends. Null while still reasoning. */
  reasoningDurationMs?: number | null;
}

function isLive(m: Props["message"]): m is LiveAssistantMessage {
  return m.id === "live";
}

export function MessageBubble({
  message,
  previews = [],
  liveCalls = [],
  onConfirmPreview,
  onCancelPreview,
  previewsDisabled,
  userName,
  userAvatarUrl,
}: Props) {
  const isUser = message.role === "user";

  // For assistant messages: pull reasoning from the live shape when present,
  // otherwise from the persisted DTO. Live mode = the bubble is still
  // streaming AND reasoning hasn't been marked done yet.
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

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className="shrink-0 self-start pt-0.5">
        {isUser ? (
          <ProfileAvatar name={userName ?? "You"} avatarUrl={userAvatarUrl} size="sm" />
        ) : (
          <AssistantAvatar size="sm" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-app-lg px-3 py-2 text-sm ${
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
        {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
        {!isUser &&
          previews.map((p) => (
            <PreviewCard
              key={p.shortHandle}
              preview={p}
              disabled={previewsDisabled}
              onConfirm={() => onConfirmPreview?.(p)}
              onCancel={() => onCancelPreview?.(p)}
            />
          ))}
      </div>
    </div>
  );
}
