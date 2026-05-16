import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatPreviewEvent,
  ChatToolCallStartEvent,
  ChatToolCallEndEvent,
  ChatDoneEvent,
} from "@internal/shared-types";

// Hand-rolled SSE consumer for /api/chat/conversations/:id/messages. The
// browser EventSource doesn't support POST bodies, so we use fetch() with a
// streaming response and parse `event:`/`data:` frames manually. The hook
// exposes everything the UI needs to render a turn: the streaming token text,
// the tool-call timeline (both reads and writes), structured preview cards,
// and a final "done" signal.

export type ChatStreamStatus = "idle" | "streaming" | "done" | "error";

export interface ChatToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  done: boolean;
}

export interface ChatStreamState {
  status: ChatStreamStatus;
  /** Streaming assistant text. */
  text: string;
  toolCalls: ChatToolCallView[];
  /** Structured preview events emitted by *_prepare tools. */
  previews: ChatPreviewEvent[];
  /** True while a *_submit tool call is mid-execution; UI uses this to disable the Stop button */
  submitInFlight: boolean;
  done?: ChatDoneEvent;
  error?: string;
}

const initial: ChatStreamState = {
  status: "idle",
  text: "",
  toolCalls: [],
  previews: [],
  submitInFlight: false,
};

export function useChatStream(conversationId: string | null) {
  const [state, setState] = useState<ChatStreamState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState(initial);
  }, []);

  const send = useCallback(
    async (content: string, overrideConversationId?: string) => {
      // Allow callers to pass a freshly-created conversation id directly,
      // bypassing the closed-over conversationId. Without this, sending the
      // very first message after creating a conversation reads the stale
      // null id from this hook's closure and throws.
      const cid = overrideConversationId ?? conversationId;
      if (!cid) throw new Error("No conversation selected");
      // Abort any in-flight stream before starting a new one.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ ...initial, status: "streaming" });

      try {
        const res = await fetch(`/api/chat/conversations/${encodeURIComponent(cid)}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ content }),
          signal: ac.signal,
        });
        if (!res.ok) {
          let bodyText: string;
          try {
            const j = await res.json();
            bodyText = (j as { error?: string }).error ?? res.statusText;
          } catch {
            bodyText = res.statusText;
          }
          setState((s) => ({ ...s, status: "error", error: bodyText }));
          return;
        }
        if (!res.body) {
          setState((s) => ({ ...s, status: "error", error: "No response body" }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Frames are separated by blank lines per the SSE spec.
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handleFrame(frame, setState);
          }
        }
        setState((s) => (s.status === "streaming" ? { ...s, status: "done" } : s));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [conversationId],
  );

  const abort = useCallback(() => {
    if (!conversationId) return;
    abortRef.current?.abort();
    // Tell the server to drop its in-flight controller. Best-effort — the
    // route also detects req.close.
    void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/abort`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { state, send, abort, reset };
}

function handleFrame(
  frame: string,
  setState: React.Dispatch<React.SetStateAction<ChatStreamState>>,
) {
  // Each frame: `event: <name>\ndata: <json>` (whitespace tolerated).
  let eventName = "message";
  let dataStr = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return;
  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }
  switch (eventName) {
    case "token": {
      const t = (data as { text?: string }).text ?? "";
      setState((s) => ({ ...s, text: s.text + t }));
      break;
    }
    case "tool_call_start": {
      const e = data as ChatToolCallStartEvent;
      setState((s) => ({
        ...s,
        submitInFlight: e.name.endsWith("_submit") ? true : s.submitInFlight,
        toolCalls: [...s.toolCalls, { id: e.id, name: e.name, args: e.args, done: false }],
      }));
      break;
    }
    case "tool_call_end": {
      const e = data as ChatToolCallEndEvent;
      setState((s) => ({
        ...s,
        submitInFlight: e.name.endsWith("_submit") ? false : s.submitInFlight,
        toolCalls: s.toolCalls.map((c) =>
          c.id === e.id ? { ...c, result: e.result, error: e.error?.message, done: true } : c,
        ),
      }));
      break;
    }
    case "preview": {
      const e = data as ChatPreviewEvent;
      setState((s) => ({ ...s, previews: [...s.previews, e] }));
      break;
    }
    case "error": {
      const e = data as { message: string; code?: string };
      setState((s) => ({ ...s, status: "error", error: e.message }));
      break;
    }
    case "done": {
      const e = data as ChatDoneEvent;
      setState((s) => ({ ...s, status: "done", done: e }));
      break;
    }
  }
}
