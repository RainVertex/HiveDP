import { useEffect, useRef, useState } from "react";

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  /** True while a turn is in flight; the send button toggles to Stop. */
  streaming: boolean;
  /** Disables the Stop button. */
  stopDisabled?: boolean;
  placeholder?: string;
}

export function Composer({ onSend, onStop, streaming, stopDisabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to a max height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="border-t border-app-border bg-app-surface p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder ?? "Ask about your work, teams, requests…"}
          rows={1}
          disabled={streaming}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          className="flex-1 resize-none rounded-app-md border border-app-border bg-app-bg-sunken px-3 py-2 text-sm text-app-text placeholder:text-app-text-subtle focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-60 [&::-webkit-scrollbar]:hidden"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopDisabled}
            title={
              stopDisabled
                ? "submission in progress — wait for it to complete or roll back"
                : "Stop"
            }
            className="h-9 rounded-app-md border border-app-border bg-app-surface px-4 text-sm text-app-text hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="h-9 rounded-app-md bg-app-primary px-4 text-sm font-medium text-app-primary-foreground hover:bg-app-primary-hover disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
