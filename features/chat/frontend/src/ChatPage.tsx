import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useApi } from "@internal/api-client/react";
import type {
  ChatConversationDetailDto,
  ChatConversationSummaryDto,
  ChatMessageDto,
  ChatPreviewEvent,
} from "@internal/shared-types";
import { ConversationList } from "./ConversationList";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { useChatStream } from "./chatStream";

interface ChatPageProps {
  /** Apps-web resolves auth and passes the current user in so feature code stays decoupled. */
  userName?: string;
  userAvatarUrl?: string | null;
}

// Full-page chat surface. Three columns visually but two functionally:
// left rail with conversation list, main pane with messages + composer.
//
// Streaming + abort: useChatStream owns the SSE consumer. When a message is
// in flight, the Composer renders a Stop button; while a *_submit is running,
// Stop is disabled (stream.submitInFlight) so we don't orphan a GitHub team
// mid-runApproval. The card "Confirm" button sends the literal text
// "Confirm submission" as the next user message, keeping the confirmation
// flow inside the transcript and the audit trail.

export function ChatPage({ userName, userAvatarUrl }: ChatPageProps = {}) {
  const api = useApi();
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();

  // Persist the panel split across reloads. v4 of react-resizable-panels
  // replaced the legacy `autoSaveId` prop with this hook + manual layout
  // wiring. The `v2` suffix is intentional: an earlier integration passed
  // pixel-numeric sizes by mistake, and bumping the id discards those
  // broken stored values.
  const persistedLayout = useDefaultLayout({
    id: "chat-page-layout-v2",
    panelIds: ["conversations", "main"],
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });

  const [conversations, setConversations] = useState<ChatConversationSummaryDto[]>([]);
  const [active, setActive] = useState<ChatConversationDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Optimistic user message kept OUTSIDE `active` so that any transient
  // setActive(null) — from a 404/race in the conv-load effect, or React
  // rendering the navigate before setActive applies — can't make it
  // disappear. Keyed by conversationId so a fast send-then-switch doesn't
  // leak the previous turn's pending bubble onto another conversation.
  const [pendingUserMessage, setPendingUserMessage] = useState<{
    conversationId: string;
    message: ChatMessageDto;
  } | null>(null);

  // When handleSend creates a conversation on the fly, it sets this ref to the
  // new conv's id BEFORE calling navigate(). The conv-load effect checks this
  // ref and skips its fetch for the matching id. Without this, React may render
  // the URL change (conversationId updated) before the optimistic setActive has
  // applied, so the effect would see active?.id === null !== conversationId and
  // fire a getConversation that overwrites the optimistic state mid-stream.
  const skipNextLoadRef = useRef<string | null>(null);

  const { state: stream, send, abort, reset } = useChatStream(conversationId ?? null);

  // Load conversation list whenever we land on the page.
  useEffect(() => {
    api.chat.listConversations().then(setConversations).catch(console.error);
  }, [api]);

  // Load the active conversation's messages on navigation. Skip the fetch
  // when we already have this conversation loaded locally — handleSend
  // optimistically seeds active for a freshly-created conversation, and
  // re-fetching would clobber the user's just-sent message.
  //
  // CRITICAL: also skip when a stream is in flight. The first send of a new
  // conversation does setActive(...) + navigate(...) + send(...) in quick
  // succession. React may render the URL change in a transient state where
  // `active` hasn't applied yet — that interleaved render would otherwise
  // see active?.id !== conversationId, fire setLoading(true) (hiding the
  // streaming bubble), then on resolve overwrite the optimistic state with a
  // server snapshot that doesn't yet contain the in-flight assistant message.
  // The previous reset() call here was even worse: it wiped useChatStream's
  // state mid-stream, so subsequent SSE tokens landed on status === "idle"
  // and never re-rendered the live bubble.
  useEffect(() => {
    if (!conversationId) {
      setActive(null);
      return;
    }
    if (active?.id === conversationId) return;
    if (stream.status === "streaming") return;
    if (skipNextLoadRef.current === conversationId) {
      skipNextLoadRef.current = null;
      return;
    }
    setLoading(true);
    api.chat
      .getConversation(conversationId)
      .then((c) => {
        setActive(c);
      })
      .catch((err) => {
        console.error(err);
        setActive(null);
      })
      .finally(() => setLoading(false));
  }, [api, conversationId, active?.id, stream.status]);

  // When a stream finishes, refresh the conversation so the new assistant
  // message + final tool calls land in persisted history, then reset the
  // stream. Without the reset, status stays "done" and stream.text keeps
  // rendering a live bubble on top of the now-persisted assistant message,
  // making it appear twice.
  useEffect(() => {
    if (stream.status !== "done" || !conversationId) return;
    Promise.all([api.chat.getConversation(conversationId), api.chat.listConversations()])
      .then(([detail, list]) => {
        setActive(detail);
        setConversations(list);
        // The persisted user message is now in `detail.messages`, so drop the
        // optimistic copy to avoid double-rendering the same content.
        setPendingUserMessage(null);
        reset();
      })
      .catch(console.error);
  }, [stream.status, conversationId, api, reset]);

  const handleNewChat = useCallback(() => {
    reset();
    navigate("/chat");
  }, [navigate, reset]);

  const handleDelete = useCallback(
    async (id: string) => {
      // Per memory rule, never use window.confirm — use a simple inline
      // confirmation chip instead. For v1 we use a two-step click pattern.
      if (pendingDeleteId !== id) {
        setPendingDeleteId(id);
        setTimeout(() => setPendingDeleteId(null), 3000);
        return;
      }
      await api.chat.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) navigate("/chat");
      setPendingDeleteId(null);
    },
    [api, conversationId, navigate, pendingDeleteId],
  );

  const handleSend = useCallback(
    async (text: string) => {
      let convId = conversationId;
      if (!convId) {
        // Auto-create a conversation if one isn't selected. Seed `active`
        // ourselves so the load-on-navigate effect skips its refetch and
        // our optimistic user message survives the route change. The ref is
        // the load-bearing piece: React may render the URL change before
        // setActive applies, and only the ref reliably tells the effect "we
        // just made this conv, don't fetch it".
        const conv = await api.chat.createConversation();
        skipNextLoadRef.current = conv.id;
        setConversations((prev) => [conv, ...prev]);
        setActive({ ...conv, messages: [] });
        navigate(`/chat/${conv.id}`, { replace: true });
        convId = conv.id;
      }
      // Show the user's message immediately. Kept in its own state (not
      // merged into `active.messages`) so a transient setActive(null) from
      // the conv-load effect or a 404 can't make it disappear mid-stream.
      // Cleared in the post-stream refresh below once the persisted row from
      // the server takes over.
      const optimistic: ChatMessageDto = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: text,
        toolCalls: null,
        agentRunId: null,
        reasoning: null,
        reasoningDurationMs: null,
        createdAt: new Date().toISOString(),
      };
      setPendingUserMessage({ conversationId: convId, message: optimistic });
      await send(text, convId);
    },
    [api, conversationId, navigate, send],
  );

  const handleConfirm = useCallback(
    (_p: ChatPreviewEvent) => {
      void send("Confirm submission");
    },
    [send],
  );
  const handleCancel = useCallback(
    (_p: ChatPreviewEvent) => {
      void send("Cancel, let me change something");
    },
    [send],
  );

  return (
    <Group
      orientation="horizontal"
      id="chat-page-layout-v2"
      defaultLayout={persistedLayout.defaultLayout}
      onLayoutChanged={persistedLayout.onLayoutChanged}
      className="h-[calc(100vh-3.5rem)]"
    >
      <Panel
        id="conversations"
        defaultSize="28"
        minSize="20"
        maxSize="45"
        className="flex flex-col"
      >
        <ConversationList
          conversations={conversations}
          activeId={conversationId ?? null}
          onNewChat={handleNewChat}
          onDelete={handleDelete}
        />
      </Panel>
      <Separator className="w-px bg-app-border transition-colors hover:bg-app-primary data-[active=true]:bg-app-primary" />
      <Panel id="main" className="flex flex-col">
        <main className="flex h-full flex-1 flex-col bg-app-bg">
          <header className="border-b border-app-border bg-app-surface px-4 py-3">
            <h1 className="text-sm font-semibold text-app-text">{active?.title ?? "Assistant"}</h1>
          </header>
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-app-text-muted">
              Loading…
            </div>
          ) : (
            <MessageList
              messages={active?.messages ?? []}
              pendingUserMessage={
                pendingUserMessage && pendingUserMessage.conversationId === conversationId
                  ? pendingUserMessage.message
                  : null
              }
              stream={stream}
              onConfirmPreview={handleConfirm}
              onCancelPreview={handleCancel}
              userName={userName}
              userAvatarUrl={userAvatarUrl}
            />
          )}
          <Composer
            onSend={handleSend}
            onStop={abort}
            streaming={stream.status === "streaming"}
            stopDisabled={stream.submitInFlight}
          />
        </main>
      </Panel>
    </Group>
  );
}
