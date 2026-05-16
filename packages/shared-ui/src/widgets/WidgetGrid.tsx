// Ambient `declare module "*.css"` must be visible when consumers' tsc descends
// into this source file. An `import` of the .d.ts doesn't propagate ambients.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../globals.d.ts" />
import { useMemo, useState } from "react";
import {
  GridLayout,
  type Layout,
  type LayoutItem,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./grid.css";
import type { WidgetInstance, WidgetRegistry } from "./types";
import { WidgetFrame } from "./WidgetFrame";

interface WidgetGridProps<TId extends string> {
  widgets: WidgetInstance<TId>[];
  editMode: boolean;
  registry: WidgetRegistry<TId>;
  onLayoutChange: (layout: Layout) => void;
  onRemove: (instanceId: string) => void;
  /** Required when any widget in the registry defines a `configEditor`. */
  onConfigChange?: (instanceId: string, config: Record<string, unknown>) => void;
  emptyState?: { title: string; hint: string };
}

export function WidgetGrid<TId extends string>({
  widgets,
  editMode,
  registry,
  onLayoutChange,
  onRemove,
  onConfigChange,
  emptyState,
}: WidgetGridProps<TId>) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const layout = useMemo<LayoutItem[]>(
    () =>
      widgets.map((w) => {
        const def = registry[w.widgetId];
        return {
          i: w.i,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          minW: def.minSize.w,
          minH: def.minSize.h,
        };
      }),
    [widgets, registry],
  );

  const configuring = configuringId ? widgets.find((w) => w.i === configuringId) : null;
  const ConfigEditor = configuring ? registry[configuring.widgetId].configEditor : null;

  if (widgets.length === 0) {
    const title = emptyState?.title ?? "No widgets";
    const hint = emptyState?.hint ?? 'Enter edit mode and click "Add widget" to get started.';
    return (
      <div className="rounded-xl border border-dashed border-app-border bg-app-surface/50 p-12 text-center">
        <div className="text-sm font-medium text-app-text">{title}</div>
        <div className="mt-1 text-sm text-app-text-muted">{hint}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: 12, rowHeight: 50, margin: [16, 16] }}
          dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
          resizeConfig={{ enabled: editMode }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => {
            if (editMode) onLayoutChange(next);
          }}
        >
          {widgets.map((w) => {
            const def = registry[w.widgetId];
            const Component = def.component;
            const hasEditor = Boolean(def.configEditor && onConfigChange);
            return (
              <div key={w.i}>
                <WidgetFrame
                  title={def.title}
                  editMode={editMode}
                  onRemove={() => onRemove(w.i)}
                  onConfigure={hasEditor ? () => setConfiguringId(w.i) : undefined}
                >
                  <Component config={w.config} />
                </WidgetFrame>
              </div>
            );
          })}
        </GridLayout>
      )}

      {ConfigEditor && configuring && onConfigChange && (
        <ConfigModal
          title={`Configure ${registry[configuring.widgetId].title}`}
          onClose={() => setConfiguringId(null)}
        >
          <ConfigEditor
            config={configuring.config ?? {}}
            onChange={(next) => onConfigChange(configuring.i, next)}
          />
        </ConfigModal>
      )}
    </div>
  );
}

function ConfigModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-app-border bg-app-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <h3 className="text-sm font-semibold text-app-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-app-text-muted hover:text-app-text"
          >
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-app-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-app-primary-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
