// Header-cell facet filter; portals the dropdown so the table's overflow-x-auto does not clip it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COLUMN_META, type CatalogColumnId } from "./columns";

interface Props {
  column: CatalogColumnId;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}

const POPOVER_WIDTH = 208; // matches Tailwind w-52

export function HeaderFilter({ column, options, selected, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-align if a left-aligned popover would overflow the viewport.
    const overflowsRight = rect.left + POPOVER_WIDTH > window.innerWidth - 8;
    const left = overflowsRight
      ? Math.max(8, rect.right + window.scrollX - POPOVER_WIDTH)
      : rect.left + window.scrollX;
    setPos({ top: rect.bottom + window.scrollY + 4, left });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      reposition();
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  const meta = COLUMN_META[column];
  const active = selected.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`ml-1 rounded px-1 text-[10px] leading-none ${
          active
            ? "bg-app-primary-soft text-app-primary-on"
            : "text-app-text-muted hover:bg-app-surface-hover"
        }`}
        aria-label={`Filter ${meta.label}`}
      >
        {active ? `▼ ${selected.length}` : "▾"}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            // z-50 keeps it above PageLayout's sticky page header.
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
            className="absolute z-50 rounded-md border border-app-border bg-app-surface p-2 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-wide text-app-text-muted">
              <span>Filter {meta.label}</span>
              {active && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-app-primary-on hover:underline"
                >
                  clear
                </button>
              )}
            </div>
            {options.length === 0 ? (
              <div className="px-2 py-1 text-xs text-app-text-muted">No values</div>
            ) : (
              <ul className="max-h-60 overflow-auto">
                {options.map((opt) => (
                  <li key={opt}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-app-surface-hover">
                      <input
                        type="checkbox"
                        checked={selected.includes(opt)}
                        onChange={() => onToggle(opt)}
                        className="h-3.5 w-3.5 rounded border-app-border accent-app-primary"
                      />
                      <span className="truncate text-app-text">{opt}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
