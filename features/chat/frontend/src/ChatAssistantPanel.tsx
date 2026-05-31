import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { ChatConversationDetailDto } from "@internal/shared-types";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { useChatStream } from "./chatStream";

const KEY_CONV = (uid: string) => `mep:chat-widget:conversation_id:${uid}`;

interface Props {
  userId: string;
  userName?: string;
  userAvatarUrl?: string | null;
}

// Homepage widget chat surface; scopes to one persisted conversation id in localStorage so the thread survives reloads.
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

  // If the stored id 404s (deleted elsewhere), null it out so the next send creates a fresh one.
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

  // Platform Assistant identity is global; cache the last one we see so the live bubble keeps its avatar while `active` is briefly null.
  const assistantRef = useRef<{ name: string | null; avatarUrl: string | null }>({
    name: null,
    avatarUrl: null,
  });
  if (active && (active.assistantName || active.assistantAvatarUrl)) {
    assistantRef.current = {
      name: active.assistantName ?? null,
      avatarUrl: active.assistantAvatarUrl ?? null,
    };
  }
  const assistant = assistantRef.current;

  return (
    // -m-4 cancels WidgetFrame's inner padding so MessageList/Composer sit flush.
    <div className="-m-4 flex h-[calc(100%+2rem)] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-app-border bg-app-surface px-3 py-1.5">
        <span className="truncate text-xs text-app-text-muted">{active?.title ?? "New chat"}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleNewChat}
            title="New chat"
            aria-label="New chat"
            className="flex h-8 min-w-8 items-center justify-center rounded-app-sm px-2 text-sm text-app-text-muted hover:bg-app-surface-hover sm:h-6 sm:min-w-0 sm:py-0.5 sm:text-xs"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => navigate(conversationId ? `/chat/${conversationId}` : "/chat")}
            title="Open in full view"
            aria-label="Open in full view"
            className="flex h-8 min-w-8 items-center justify-center rounded-app-sm px-2 text-sm text-app-text-muted hover:bg-app-surface-hover sm:h-6 sm:min-w-0 sm:py-0.5 sm:text-xs"
          >
            ↗
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          messages={active?.messages ?? []}
          stream={stream}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
          assistantName={assistant.name ?? undefined}
          assistantAvatarUrl={assistant.avatarUrl}
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
