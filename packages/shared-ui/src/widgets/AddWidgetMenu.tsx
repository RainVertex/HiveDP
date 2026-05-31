import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { WidgetDefinition } from "./types";
import { WidgetFrame } from "./WidgetFrame";
import "./widgetPicker.css";

interface AddWidgetMenuProps<TId extends string> {
  widgets: WidgetDefinition<TId>[];
  onAdd: (id: TId) => void;
}

export function AddWidgetMenu<TId extends string>({ widgets, onAdd }: AddWidgetMenuProps<TId>) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<TId | null>(null);

  const groups = useMemo(() => groupByCategory(widgets), [widgets]);
  const selected = useMemo(
    () => widgets.find((w) => w.id === selectedId) ?? widgets[0] ?? null,
    [widgets, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function openPicker() {
    setSelectedId(widgets[0]?.id ?? null);
    setOpen(true);
  }

  function addWidget(id: TId) {
    onAdd(id);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-app-border bg-app-surface text-sm text-app-text hover:bg-app-surface-hover transition-colors"
      >
        <PlusIcon />
        Add widget
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="flex h-[32rem] max-h-[85vh] w-[44rem] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
                <h3 className="text-sm font-semibold text-app-text">Add widget</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-app-text-muted hover:text-app-text"
                >
                  ×
                </button>
              </div>

              <div className="flex min-h-0 flex-1">
                <nav className="scrollbar-hide w-56 shrink-0 overflow-y-auto border-r border-app-border py-2">
                  {groups.map((group) => (
                    <div key={group.category} className="mb-2">
                      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-app-text-muted">
                        {group.category}
                      </div>
                      <ul>
                        {group.items.map((w) => {
                          const active = selected?.id === w.id;
                          return (
                            <li key={w.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedId(w.id)}
                                onDoubleClick={() => addWidget(w.id)}
                                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                                  active
                                    ? "bg-app-surface-hover font-medium text-app-text"
                                    : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
                                }`}
                              >
                                {w.title}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </nav>

                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                  {selected ? (
                    <>
                      <div className="scrollbar-hide min-h-0 flex-1 overflow-auto">
                        <WidgetPreview key={selected.id} widget={selected} />
                      </div>
                      <p className="text-sm text-app-text-muted">{selected.description}</p>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => addWidget(selected.id)}
                          className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-app-primary-hover transition-colors"
                        >
                          Add to dashboard
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-app-text-muted">No widgets available.</div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function WidgetPreview({ widget }: { widget: WidgetDefinition }) {
  const WidgetComponent = widget.component;
  return (
    <PreviewBoundary fallback={<PreviewFallback />}>
      <div className="h-full min-h-[12rem]">
        <WidgetFrame title={widget.title} editMode={false}>
          <div className="pointer-events-none">
            <WidgetComponent config={widget.defaultConfig} />
          </div>
        </WidgetFrame>
      </div>
    </PreviewBoundary>
  );
}

function PreviewFallback() {
  return (
    <div className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-app-border text-sm text-app-text-muted">
      Preview unavailable
    </div>
  );
}

class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

interface WidgetGroup<TId extends string> {
  category: string;
  items: WidgetDefinition<TId>[];
}

function groupByCategory<TId extends string>(
  widgets: WidgetDefinition<TId>[],
): WidgetGroup<TId>[] {
  const order: string[] = [];
  const map = new Map<string, WidgetDefinition<TId>[]>();
  for (const w of widgets) {
    const cat = w.category ?? "General";
    const bucket = map.get(cat);
    if (bucket) {
      bucket.push(w);
    } else {
      map.set(cat, [w]);
      order.push(cat);
    }
  }
  return order.map((category) => ({ category, items: map.get(category) ?? [] }));
}

function PlusIcon() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
