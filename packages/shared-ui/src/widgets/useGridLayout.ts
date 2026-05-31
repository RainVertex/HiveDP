// localStorage-backed widget grid layout state with edit/draft/commit flow.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import type { WidgetInstance, WidgetRegistry } from "./types";

interface UseGridLayoutOptions<TId extends string> {
  storageKey: string;
  defaultWidgets: WidgetInstance<TId>[];
  registry: WidgetRegistry<TId>;
}

export interface UseGridLayoutResult<TId extends string> {
  widgets: WidgetInstance<TId>[];
  editMode: boolean;
  isDirty: boolean;
  enterEdit: () => void;
  save: () => void;
  cancel: () => void;
  clearAll: () => void;
  resetToDefault: () => void;
  updateLayout: (layout: Layout) => void;
  addWidget: (widgetId: TId, initialConfig?: Record<string, unknown>) => void;
  removeWidget: (instanceId: string) => void;
  updateWidgetConfig: (instanceId: string, config: Record<string, unknown>) => void;
}

export function useGridLayout<TId extends string>({
  storageKey,
  defaultWidgets,
  registry,
}: UseGridLayoutOptions<TId>): UseGridLayoutResult<TId> {
  const readStored = useCallback((): WidgetInstance<TId>[] => {
    if (typeof window === "undefined") return defaultWidgets;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultWidgets;
      const parsed = JSON.parse(raw) as WidgetInstance<TId>[];
      if (!Array.isArray(parsed) || parsed.length === 0) return defaultWidgets;
      return parsed.filter((w) => w && registry[w.widgetId]);
    } catch {
      return defaultWidgets;
    }
  }, [storageKey, defaultWidgets, registry]);

  const persist = useCallback(
    (widgets: WidgetInstance<TId>[]) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(widgets));
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  const [committed, setCommitted] = useState<WidgetInstance<TId>[]>(() => readStored());
  const [draft, setDraft] = useState<WidgetInstance<TId>[]>(committed);
  const [editMode, setEditMode] = useState(false);

  // Reload from storage when the key changes (navigating between entities).
  useEffect(() => {
    const next = readStored();
    setCommitted(next);
    setDraft(next);
    setEditMode(false);
  }, [readStored]);

  useEffect(() => {
    if (!editMode) persist(committed);
  }, [committed, editMode, persist]);

  const widgets = editMode ? draft : committed;

  const enterEdit = useCallback(() => {
    setDraft(committed);
    setEditMode(true);
  }, [committed]);

  const save = useCallback(() => {
    setCommitted(draft);
    setEditMode(false);
  }, [draft]);

  const cancel = useCallback(() => {
    setDraft(committed);
    setEditMode(false);
  }, [committed]);

  const clearAll = useCallback(() => {
    setDraft([]);
  }, []);

  const resetToDefault = useCallback(() => {
    setCommitted(defaultWidgets);
    setDraft(defaultWidgets);
  }, [defaultWidgets]);

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
