// Themed modal confirmation dialog used in place of window.confirm.
import type { ReactNode } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  if (!open) return null;
  const confirmClass = destructive
    ? "rounded-md bg-app-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    : "rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-app-border bg-app-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold text-app-text">{title}</h3>
        {message != null && <div className="mb-3 text-xs text-app-text-muted">{message}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
          >
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={confirmClass}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
