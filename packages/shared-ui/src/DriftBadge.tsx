// Inline drift indicator pill that toggles an inline detail panel; renders null when count <= 0.
import { useState, type ReactNode } from "react";

export type DriftBadgeSeverity = "info" | "warn" | "danger";

export interface DriftBadgeProps {
  count: number;
  severity?: DriftBadgeSeverity;
  label?: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}

const SEVERITY_CLASSES: Record<DriftBadgeSeverity, string> = {
  info: "border-app-border bg-app-surface-hover text-app-text-muted",
  warn: "border-app-warning bg-app-warning-soft text-app-warning-foreground",
  danger: "border-app-danger bg-app-surface text-app-danger",
};

export function DriftBadge({
  count,
  severity = "warn",
  label = "drifted",
  children,
  defaultOpen = false,
}: DriftBadgeProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (count <= 0) return null;

  const pillClass = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[severity]} hover:opacity-90`;

  return (
    <span className="inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={pillClass}
        aria-expanded={open}
      >
        <span aria-hidden>⚠</span>
        <span>
          {count} {label}
        </span>
      </button>
      {open && children && (
        <div className="mt-2 rounded-md border border-app-border bg-app-surface p-3 text-xs text-app-text shadow-sm">
          {children}
        </div>
      )}
    </span>
  );
}
