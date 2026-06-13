import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatToolCallStartEvent, ChatToolCallEndEvent } from "@internal/shared-types";

// React hook that consumes the chat SSE stream via fetch (EventSource lacks POST bodies).

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
  text: string;
  reasoning: string;
  reasoningStartedAt: number | null;
  reasoningDurationMs: number | null;
  toolCalls: ChatToolCallView[];
  submitInFlight: boolean;
  error?: string;
}

const initial: ChatStreamState = {
  status: "idle",
  text: "",
  reasoning: "",
  reasoningStartedAt: null,
  reasoningDurationMs: null,
  toolCalls: [],
  submitInFlight: false,
};

export function useChatStream(conversationId: string | null) {
  const [state, setState] = useState<ChatStreamState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState(initial);
  }, []);

  const send = useCallback(
    async (
      content: string,
      attachments?: { dataUrl: string; mimeType: string }[],
      overrideConversationId?: string,
    ) => {
      // Override lets the first message use a freshly-created id, not the stale closure value.
      const cid = overrideConversationId ?? conversationId;
      if (!cid) throw new Error("No conversation selected");
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ ...initial, status: "streaming" });

      try {
        const res = await fetch(`/api/chat/conversations/${encodeURIComponent(cid)}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({
            content,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          }),
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
    // Best-effort server-side cancel, the route also detects req.close.
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
    case "reasoning_token": {
      const t = (data as { text?: string }).text ?? "";
      setState((s) => ({
        ...s,
        reasoning: s.reasoning + t,
        reasoningStartedAt: s.reasoningStartedAt ?? Date.now(),
      }));
      break;
    }
    case "reasoning_done": {
      const ms = (data as { durationMs?: number }).durationMs ?? 0;
      setState((s) => ({ ...s, reasoningDurationMs: ms }));
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
      // Emitted for *_prepare tools, intentionally not rendered.
      break;
    }
    case "error": {
      const e = data as { message: string; code?: string };
      setState((s) => ({ ...s, status: "error", error: e.message }));
      break;
    }
    case "done": {
      setState((s) => ({ ...s, status: "done" }));
      break;
    }
  }
}
