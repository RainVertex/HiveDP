// Card chrome wrapping a single widget: title bar, drag handle, and edit-mode configure/remove buttons.
import type { PropsWithChildren } from "react";

interface WidgetFrameProps extends PropsWithChildren {
  title: string;
  editMode: boolean;
  onRemove?: () => void;
  onConfigure?: () => void;
}

export function WidgetFrame({
  title,
  editMode,
  onRemove,
  onConfigure,
  children,
}: WidgetFrameProps) {
  return (
    <div
      className={`h-full flex flex-col rounded-xl border bg-app-surface shadow-sm overflow-hidden ${
        editMode ? "border-app-primary/50 ring-1 ring-app-primary/20" : "border-app-border"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2 border-b border-app-border ${
          editMode ? "widget-drag-handle cursor-move bg-app-surface-hover" : ""
        }`}
      >
        <h3 className="text-sm font-semibold text-app-text truncate">{title}</h3>
        {editMode && (onConfigure || onRemove) && (
          <div className="flex items-center gap-1">
            {onConfigure && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onConfigure}
                aria-label={`Configure ${title}`}
                className="text-app-text-muted hover:text-app-primary transition-colors"
              >
                <GearIcon />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onRemove}
                aria-label={`Remove ${title}`}
                className="text-app-text-muted hover:text-app-danger transition-colors"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 p-4 overflow-auto">{children}</div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
