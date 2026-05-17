import { useEffect, useRef } from "react";
import type { ChatMessageDto, ChatPreviewEvent } from "@internal/shared-types";
import { MessageBubble } from "./MessageBubble";
import type { ChatStreamState } from "./chatStream";

interface Props {
  messages: ChatMessageDto[];
  stream: ChatStreamState;
  onConfirmPreview: (preview: ChatPreviewEvent) => void;
  onCancelPreview: (preview: ChatPreviewEvent) => void;
  /** Current user, used by MessageBubble to render the right-side avatar. */
  userName?: string;
  userAvatarUrl?: string | null;
}

export function MessageList({
  messages,
  stream,
  onConfirmPreview,
  onCancelPreview,
  userName,
  userAvatarUrl,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Autoscroll on new tokens / new messages.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, stream.text, stream.reasoning, stream.toolCalls.length, stream.previews.length]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages.length === 0 && stream.status === "idle" && (
        <div className="mx-auto max-w-md rounded-app-lg border border-app-border bg-app-surface p-4 text-center text-sm text-app-text-muted">
          <p className="mb-1 font-medium text-app-text">Welcome to the Assistant</p>
          <p>
            Ask about your work, teams, catalog entities, requests, or anything readable in the app.
            You can also start a team-creation request directly here.
          </p>
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} userName={userName} userAvatarUrl={userAvatarUrl} />
      ))}
      {(stream.status === "streaming" ||
        stream.status === "done" ||
        (stream.status !== "idle" &&
          (stream.text ||
            stream.reasoning ||
            stream.toolCalls.length > 0 ||
            stream.previews.length > 0))) && (
        <MessageBubble
          message={{
            id: "live",
            role: "assistant",
            content: stream.text,
            reasoning: stream.reasoning,
            reasoningStartedAt: stream.reasoningStartedAt,
            reasoningDurationMs: stream.reasoningDurationMs,
          }}
          previews={stream.previews}
          liveCalls={stream.toolCalls}
          previewsDisabled={stream.submitInFlight}
          onConfirmPreview={onConfirmPreview}
          onCancelPreview={onCancelPreview}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
        />
      )}
      {stream.status === "error" && stream.error && (
        <div className="rounded-app-md border border-app-border bg-app-danger-soft px-3 py-2 text-sm text-app-danger-foreground">
          {stream.error}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
