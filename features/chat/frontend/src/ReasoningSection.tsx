import { useEffect, useRef, useState } from "react";

// Collapsible header + body rendering the model's `<think>` content. The
// header reads "Reasoning - Ns" while the model is still thinking, with the
// counter ticking live, and flips to "Reasoned - Ns" once reasoning ends.
// On the flip, the section auto-collapses exactly once; after that the user
// owns the toggle state.

interface Props {
  reasoning: string;
  /** Client-side ms-since-epoch when the first reasoning token arrived. */
  startedAt?: number | null;
  /** Final server-reported duration. Null while still streaming. */
  durationMs: number | null;
  /** True iff this is the live (in-flight) assistant turn AND reasoning hasn't finished. */
  isStreaming: boolean;
}

export function ReasoningSection({ reasoning, startedAt, durationMs, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(isStreaming);
  const userToggled = useRef(false);
  const lastStreamingRef = useRef(isStreaming);
  const [now, setNow] = useState(() => Date.now());

  // Auto-collapse exactly once when reasoning transitions from streaming → done,
  // unless the user has manually toggled at some point.
  useEffect(() => {
    const wasStreaming = lastStreamingRef.current;
    lastStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming && !userToggled.current) {
      setExpanded(false);
    }
  }, [isStreaming]);

  // Tick the live counter while streaming.
  useEffect(() => {
    if (!isStreaming) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  const elapsedMs = isStreaming
    ? startedAt != null
      ? Math.max(0, now - startedAt)
      : 0
    : (durationMs ?? 0);
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  const label = isStreaming ? `Reasoning - ${seconds}s` : `Reasoned - ${seconds}s`;

  const toggle = () => {
    userToggled.current = true;
    setExpanded((v) => !v);
  };

  return (
    <div className="mb-2 rounded-app-md border border-app-border bg-app-bg">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-xs text-app-text-muted hover:text-app-text"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-app-text-muted">
            ⋯
          </span>
          <span>{label}</span>
        </span>
        <span aria-hidden>{expanded ? <ChevronUp /> : <ChevronDown />}</span>
      </button>
      {expanded && (
        <div className="border-t border-app-border px-3 py-2 text-xs whitespace-pre-wrap text-app-text-muted">
          {reasoning || (isStreaming ? "…" : "")}
        </div>
      )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ChevronUp() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}
