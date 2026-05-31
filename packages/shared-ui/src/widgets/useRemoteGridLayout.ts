// Server-backed widget grid layout state with edit/draft/commit and async save.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import type { WidgetInstance, WidgetRegistry } from "./types";

interface UseRemoteGridLayoutOptions<TId extends string> {
  initialWidgets: WidgetInstance<TId>[];
  registry: WidgetRegistry<TId>;
  /** Persist `draft` to the server. */
  onSave: (widgets: WidgetInstance<TId>[]) => Promise<void>;
  /** When true, edit mode cannot be entered. */
  readOnly?: boolean;
}

export interface UseRemoteGridLayoutResult<TId extends string> {
  widgets: WidgetInstance<TId>[];
  editMode: boolean;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  enterEdit: () => void;
  save: () => Promise<void>;
  cancel: () => void;
  clearAll: () => void;
  /** No-op for remote layouts. */
  resetToDefault: () => void;
  updateLayout: (layout: Layout) => void;
  addWidget: (widgetId: TId, initialConfig?: Record<string, unknown>) => void;
  removeWidget: (instanceId: string) => void;
  updateWidgetConfig: (instanceId: string, config: Record<string, unknown>) => void;
}

/** Server-backed twin of `useGridLayout`. */
export function useRemoteGridLayout<TId extends string>({
  initialWidgets,
  registry,
  onSave,
  readOnly = false,
}: UseRemoteGridLayoutOptions<TId>): UseRemoteGridLayoutResult<TId> {
  const [committed, setCommitted] = useState<WidgetInstance<TId>[]>(initialWidgets);
  const [draft, setDraft] = useState<WidgetInstance<TId>[]>(initialWidgets);
  const [editMode, setEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Compare initialWidgets by content so an unmemoized but equal array does not reset editMode mid-edit.
  const initialKey = useMemo(() => JSON.stringify(initialWidgets), [initialWidgets]);
  useEffect(() => {
    setCommitted(initialWidgets);
    setDraft(initialWidgets);
    setEditMode(false);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const widgets = editMode ? draft : committed;

  const enterEdit = useCallback(() => {
    if (readOnly) return;
    setDraft(committed);
    setSaveError(null);
    setEditMode(true);
  }, [committed, readOnly]);

  const save = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setCommitted(draft);
      setEditMode(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save layout");
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, onSave]);

  const cancel = useCallback(() => {
    setDraft(committed);
    setSaveError(null);
    setEditMode(false);
  }, [committed]);

  const clearAll = useCallback(() => {
    setDraft([]);
  }, []);

  const resetToDefault = useCallback(() => {
    // Remote layouts have no inherent default, kept as a no-op for parity with useGridLayout.
  }, []);

  const updateLayout = useCallback((layout: Layout) => {
    setDraft((prev) =>
      prev.map((widget) => {
        const l = layout.find((item) => item.i === widget.i);
        if (!l) return widget;
        return { ...widget, x: l.x, y: l.y, w: l.w, h: l.h };
      }),
    );
  }, []);

  const addWidget = useCallback(
    (widgetId: TId, initialConfig?: Record<string, unknown>) => {
      setDraft((prev) => {
        const def = registry[widgetId];
        const maxY = prev.reduce((max, w) => Math.max(max, w.y + w.h), 0);
        const config = initialConfig ?? def.defaultConfig;
        const instance: WidgetInstance<TId> = {
          i: `${widgetId}-${Date.now().toString(36)}`,
          widgetId,
          x: 0,
          y: maxY,
          w: def.defaultSize.w,
          h: def.defaultSize.h,
          ...(config ? { config } : {}),
        };
        return [...prev, instance];
      });
    },
    [registry],
  );

  const removeWidget = useCallback((instanceId: string) => {
    setDraft((prev) => prev.filter((w) => w.i !== instanceId));
  }, []);

  const updateWidgetConfig = useCallback((instanceId: string, config: Record<string, unknown>) => {
    setDraft((prev) => prev.map((w) => (w.i === instanceId ? { ...w, config } : w)));
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(committed),
    [draft, committed],
  );

  return {
    widgets,
    editMode,
    isDirty,
    isSaving,
    saveError,
    enterEdit,
    save,
    cancel,
    clearAll,
    resetToDefault,
    updateLayout,
    addWidget,
    removeWidget,
    updateWidgetConfig,
  };
}
