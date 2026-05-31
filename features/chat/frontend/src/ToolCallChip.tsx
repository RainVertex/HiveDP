// Compact, click-to-expand pill for one tool call; style and prefix vary by tool-name suffix.
import { useState } from "react";
import type { ChatToolCallView } from "./chatStream";

interface Props {
  call: ChatToolCallView;
}

export function ToolCallChip({ call }: Props) {
  const [open, setOpen] = useState(false);
  const isWrite = call.name.endsWith("_submit");
  const isPrepare = call.name.endsWith("_prepare");
  const failed = !!call.error;

  let chipClass: string;
  let prefix: string;
  if (isWrite) {
    chipClass = failed
      ? "bg-app-danger-soft text-app-danger-foreground border border-app-border-strong"
      : "bg-app-primary-soft text-app-primary-soft-foreground border border-app-border-strong";
    prefix = failed ? "❌" : call.done ? "✓" : "⏳";
  } else if (isPrepare) {
    chipClass = "bg-app-bg-sunken text-app-text-muted";
    prefix = "📋";
  } else {
    chipClass = "bg-app-bg-sunken text-app-text-muted";
    prefix = call.done ? "🔧" : "⏳";
  }

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-app-sm px-2 py-0.5 text-xs ${chipClass}`}
      >
        <span aria-hidden>{prefix}</span>
        <span className="font-mono">{call.name}</span>
      </button>
      {open && (
        <div className="ml-2 mt-1 rounded-app-md border border-app-border bg-app-bg-sunken p-2 text-[11px]">
          <div className="font-mono text-app-text-muted">args:</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-app-text">
            {JSON.stringify(call.args, null, 2)}
          </pre>
          {call.done && (
            <>
              <div className="mt-2 font-mono text-app-text-muted">
                {call.error ? "error:" : "result:"}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-app-text">
                {call.error ?? JSON.stringify(call.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
