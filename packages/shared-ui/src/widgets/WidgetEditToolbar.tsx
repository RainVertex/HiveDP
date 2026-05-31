// Toolbar with Customize/edit-mode controls (clear, add, cancel, save, reset) for a widget grid.
import { AddWidgetMenu } from "./AddWidgetMenu";
import type { WidgetDefinition } from "./types";
import type { UseGridLayoutResult } from "./useGridLayout";
import type { UseRemoteGridLayoutResult } from "./useRemoteGridLayout";

interface WidgetEditToolbarProps<TId extends string> {
  // Accepts either the localStorage-backed hook (home page) or the server-backed hook.
  layout: UseGridLayoutResult<TId> | UseRemoteGridLayoutResult<TId>;
  availableWidgets: WidgetDefinition<TId>[];
  // Hide "Reset" when there's no inherent default to reset to.
  hideReset?: boolean;
}

export function WidgetEditToolbar<TId extends string>({
  layout,
  availableWidgets,
  hideReset,
}: WidgetEditToolbarProps<TId>) {
  const { editMode, isDirty, enterEdit, save, cancel, clearAll, resetToDefault, addWidget } =
    layout;
  const isSaving = "isSaving" in layout ? layout.isSaving : false;
  const saveError = "saveError" in layout ? layout.saveError : null;

  if (editMode) {
    return (
      <div className="flex items-center gap-2">
        {saveError && (
          <span className="text-xs text-app-danger" role="alert">
            {saveError}
          </span>
        )}
        <button
          type="button"
          onClick={clearAll}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-app-border bg-app-surface text-sm text-app-danger hover:bg-app-surface-hover transition-colors disabled:opacity-50"
        >
          Clear all
        </button>
        <AddWidgetMenu widgets={availableWidgets} onAdd={addWidget} />
        <button
          type="button"
          onClick={cancel}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-md border border-app-border bg-app-surface text-sm text-app-text hover:bg-app-surface-hover transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!isDirty || isSaving}
          className="px-3 py-1.5 rounded-md bg-app-primary text-white text-sm font-medium hover:bg-app-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!hideReset && (
        <button
          type="button"
          onClick={resetToDefault}
          className="px-3 py-1.5 rounded-md border border-app-border bg-app-surface text-sm text-app-text-muted hover:text-app-text hover:bg-app-surface-hover transition-colors"
        >
          Reset
        </button>
      )}
      <button
        type="button"
        onClick={enterEdit}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-app-primary text-white text-sm font-medium hover:bg-app-primary-hover transition-colors"
      >
        <EditIcon />
        Customize
      </button>
    </div>
  );
}

function EditIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
