import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useApi } from "@internal/api-client/react";
import type {
  ChatConversationDetailDto,
  ChatConversationSummaryDto,
  ChatMessageDto,
} from "@internal/shared-types";
import { ConversationList } from "./ConversationList";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { useChatStream } from "./chatStream";
import { MenuIcon } from "./icons";

// Full-page chat surface: resizable two-column layout on desktop, single pane + drawer below md.

// JS breakpoint flip (not CSS) so only one MessageList mounts; two would fight over the autoscroll ref.
function useIsMobile(): boolean {
  const query = "(max-width: 767px)";
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return matches;
}

interface ChatPageProps {
  userName?: string;
  userAvatarUrl?: string | null;
}

// Stop is disabled during a *_submit (stream.submitInFlight) so we don't orphan a GitHub team mid-approval.
export function ChatPage({ userName, userAvatarUrl }: ChatPageProps = {}) {
  const api = useApi();
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The `v2` id suffix is intentional: it discards stored pixel-numeric sizes an earlier integration saved by mistake.
  const persistedLayout = useDefaultLayout({
    id: "chat-page-layout-v2",
    panelIds: ["conversations", "main"],
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });

  const [conversations, setConversations] = useState<ChatConversationSummaryDto[]>([]);
  const [active, setActive] = useState<ChatConversationDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Kept outside `active` so a transient setActive(null) can't drop it; keyed by conversationId to avoid leaking across threads.
  const [pendingUserMessage, setPendingUserMessage] = useState<{
    conversationId: string;
    message: ChatMessageDto;
  } | null>(null);

  // Set before navigate() on a new conv so the conv-load effect skips its fetch and doesn't clobber optimistic state mid-stream.
  const skipNextLoadRef = useRef<string | null>(null);

  const { state: stream, send, abort, reset } = useChatStream(conversationId ?? null);

  useEffect(() => {
    api.chat.listConversations().then(setConversations).catch(console.error);
  }, [api]);

  // Load messages on navigation, but skip when already loaded or a stream is in flight so we don't clobber optimistic/live state.
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

  // On stream end, refresh persisted history then reset the stream; without the reset the live bubble double-renders.
  useEffect(() => {
    if (stream.status !== "done" || !conversationId) return;
    Promise.all([api.chat.getConversation(conversationId), api.chat.listConversations()])
      .then(([detail, list]) => {
        setActive(detail);
        setConversations(list);
        setPendingUserMessage(null);
        reset();
      })
      .catch(console.error);
  }, [stream.status, conversationId, api, reset]);

  const handleNewChat = useCallback(() => {
    reset();
    navigate("/chat");
  }, [navigate, reset]);

  const handleRequestDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      await api.chat.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) navigate("/chat");
      setPendingDeleteId(null);
    },
    [api, conversationId, navigate],
  );

  const handleSend = useCallback(
    async (text: string) => {
      let convId = conversationId;
      if (!convId) {
        // Auto-create when none selected; the ref (not setActive) reliably tells the load effect to skip refetching this new conv.
        const conv = await api.chat.createConversation();
        skipNextLoadRef.current = conv.id;
        setConversations((prev) => [conv, ...prev]);
        setActive({ ...conv, messages: [] });
        navigate(`/chat/${conv.id}`, { replace: true });
        convId = conv.id;
      }
      // Optimistic bubble in its own state so a transient setActive(null) can't drop it mid-stream; cleared after the post-stream refresh.
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

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Platform Assistant identity is global; cache the last one we see so the live bubble keeps its avatar while `active` is briefly null.
  const assistantRef = useRef<{ name: string | null; avatarUrl: string | null }>({
    name: null,
    avatarUrl: null,
  });
  const seenAssistant =
    active?.assistantName || active?.assistantAvatarUrl
      ? active
      : conversations.find((c) => c.assistantName || c.assistantAvatarUrl);
  if (seenAssistant && (seenAssistant.assistantName || seenAssistant.assistantAvatarUrl)) {
    assistantRef.current = {
      name: seenAssistant.assistantName ?? null,
      avatarUrl: seenAssistant.assistantAvatarUrl ?? null,
    };
  }
  const assistant = assistantRef.current;

  const mainPane = (
    <main className="flex h-full flex-1 flex-col bg-app-bg">
      <header className="flex items-center gap-2 border-b border-app-border bg-app-surface px-3 py-2.5 sm:px-4 sm:py-3">
        {isMobile && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open conversations"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-app-md text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            <MenuIcon />
          </button>
        )}
        <h1 className="truncate text-sm font-semibold text-app-text">
          {active?.title ?? "Assistant"}
        </h1>
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
          userName={userName}
          userAvatarUrl={userAvatarUrl}
          assistantName={assistant.name ?? undefined}
          assistantAvatarUrl={assistant.avatarUrl}
        />
      )}
      <Composer
        onSend={handleSend}
        onStop={abort}
        streaming={stream.status === "streaming"}
        stopDisabled={stream.submitInFlight}
      />
    </main>
  );

  if (isMobile) {
    return (
      <div className="relative flex h-[calc(100vh-3.5rem)] flex-col">
        {mainPane}
        {/* Slide-in drawer for the conversation list; backdrop tap dismisses. */}
        <div
          className={`fixed inset-0 z-40 transition-opacity ${
            drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!drawerOpen}
        >
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} role="presentation" />
          <aside
            className={`absolute left-0 top-0 flex h-full w-72 max-w-[80vw] flex-col border-r border-app-border bg-app-surface shadow-xl transition-transform duration-200 ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <ConversationList
              conversations={conversations}
              activeId={conversationId ?? null}
              pendingDeleteId={pendingDeleteId}
              onNewChat={handleNewChat}
              onRequestDelete={handleRequestDelete}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
              onSelect={closeDrawer}
            />
          </aside>
        </div>
      </div>
    );
  }

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
          pendingDeleteId={pendingDeleteId}
          onNewChat={handleNewChat}
          onRequestDelete={handleRequestDelete}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={handleCancelDelete}
        />
      </Panel>
      <Separator className="w-px bg-app-border transition-colors hover:bg-app-primary data-[active=true]:bg-app-primary" />
      <Panel id="main" className="flex flex-col">
        {mainPane}
      </Panel>
    </Group>
  );
}
