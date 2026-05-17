import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { ChatConversationDetailDto, ChatPreviewEvent } from "@internal/shared-types";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { useChatStream } from "./chatStream";

const KEY_CONV = (uid: string) => `mep:chat-widget:conversation_id:${uid}`;

interface Props {
  /** Auth identity of the current user; used to scope the per-user localStorage key so logging */
  userId: string;
  /** Display name + avatar drive the right-side bubble avatar on user messages. */
  userName?: string;
  userAvatarUrl?: string | null;
}

// In-page chat surface (the homepage widget body). Same SSE consumer as the
// full ChatPage, but scoped to a single persisted conversation id stored in
// localStorage so the widget remembers your last thread across reloads.
export function ChatAssistantPanel({ userId, userName, userAvatarUrl }: Props) {
  const api = useApi();
  const navigate = useNavigate();
  const storageKey = KEY_CONV(userId);

  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(storageKey),
  );
  const [active, setActive] = useState<ChatConversationDetailDto | null>(null);

  const { state: stream, send, abort, reset } = useChatStream(conversationId);

  useEffect(() => {
    if (conversationId) window.localStorage.setItem(storageKey, conversationId);
    else window.localStorage.removeItem(storageKey);
  }, [conversationId, storageKey]);

  // Hydrate active conversation. If the stored id 404s (deleted from /chat),
  // null it out and let the next send create a fresh one.
  useEffect(() => {
    if (!conversationId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    api.chat
      .getConversation(conversationId)
      .then((c) => {
        if (!cancelled) setActive(c);
      })
      .catch(() => {
        if (!cancelled) {
          setActive(null);
          setConversationId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, conversationId]);

  // Persist freshly-streamed turns back into the conversation detail.
  useEffect(() => {
    if (stream.status !== "done" || !conversationId) return;
    api.chat
      .getConversation(conversationId)
      .then((c) => {
        setActive(c);
        reset();
      })
      .catch(console.error);
  }, [api, stream.status, conversationId, reset]);

  const handleSend = useCallback(
    async (text: string) => {
      let convId = conversationId;
      if (!convId) {
        const conv = await api.chat.createConversation();
        setConversationId(conv.id);
        setActive({ ...conv, messages: [] });
        convId = conv.id;
      }
      await send(text, convId);
    },
    [api, conversationId, send],
  );

  const handleNewChat = useCallback(() => {
    setConversationId(null);
    setActive(null);
    reset();
  }, [reset]);

  const handleConfirm = useCallback(
    (_p: ChatPreviewEvent) => void send("Confirm submission"),
    [send],
  );
  const handleCancel = useCallback(
    (_p: ChatPreviewEvent) => void send("Cancel, let me change something"),
    [send],
  );

  return (
    // -m-4 cancels WidgetFrame's inner padding so MessageList/Composer sit
    // flush — Composer has its own border-t to separate from messages.
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col">
      <div className="flex items-center justify-between border-b border-app-border bg-app-surface px-3 py-1.5">
        <span className="truncate text-xs text-app-text-muted">{active?.title ?? "New chat"}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleNewChat}
            title="New chat"
            className="rounded-app-sm px-2 py-0.5 text-xs text-app-text-muted hover:bg-app-surface-hover"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => navigate(conversationId ? `/chat/${conversationId}` : "/chat")}
            title="Open in full view"
            className="rounded-app-sm px-2 py-0.5 text-xs text-app-text-muted hover:bg-app-surface-hover"
          >
            ↗
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          messages={active?.messages ?? []}
          stream={stream}
          onConfirmPreview={handleConfirm}
          onCancelPreview={handleCancel}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
        />
        <Composer
          onSend={handleSend}
          onStop={abort}
          streaming={stream.status === "streaming"}
          stopDisabled={stream.submitInFlight}
          placeholder="Ask anything…"
        />
      </div>
    </div>
  );
}
