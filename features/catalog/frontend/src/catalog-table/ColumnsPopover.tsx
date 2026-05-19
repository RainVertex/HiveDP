import { useEffect, useRef, useState } from "react";
import { COLUMN_META, COLUMN_ORDER, PINNED_COLUMN, type CatalogColumnId } from "./columns";

interface Props {
  visibleColumns: CatalogColumnId[];
  onToggle: (id: CatalogColumnId) => void;
}

export function ColumnsPopover({ visibleColumns, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleSet = new Set(visibleColumns);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-xs text-app-text hover:bg-app-surface-hover"
      >
        Manage properties ▾
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-app-border bg-app-surface p-2 shadow-lg">
          <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-app-text-muted">
            Columns
          </div>
          <ul className="max-h-72 overflow-auto">
            {COLUMN_ORDER.map((id) => {
              const isPinned = id === PINNED_COLUMN;
              const checked = visibleSet.has(id);
              return (
                <li key={id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-app-surface-hover ${
                      isPinned ? "cursor-not-allowed opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPinned}
                      onChange={() => onToggle(id)}
                      className="h-3.5 w-3.5 rounded border-app-border accent-app-primary"
                    />
                    <span className="text-app-text">{COLUMN_META[id].label}</span>
                    {isPinned && (
                      <span className="ml-auto text-[10px] text-app-text-muted">pinned</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
