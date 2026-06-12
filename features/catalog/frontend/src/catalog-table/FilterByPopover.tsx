// Toolbar popover with multi-select status filters (stale, orphaned).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@internal/i18n";

interface Props {
  hideStale: boolean;
  hideOrphaned: boolean;
  onToggleStale: () => void;
  onToggleOrphaned: () => void;
}

export function FilterByPopover({
  hideStale,
  hideOrphaned,
  onToggleStale,
  onToggleOrphaned,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("catalog");

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

  const activeCount = (hideStale ? 1 : 0) + (hideOrphaned ? 1 : 0);

  const ariaLabel =
    activeCount > 0
      ? t("filterBy.buttonLabel_other", { count: activeCount })
      : t("filterBy.buttonLabelNone");

  return (
    <label className="flex items-center gap-2 text-xs text-app-text-muted">
      {t("filterBy.label")}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-pressed={activeCount > 0}
          aria-label={ariaLabel}
          className={
            activeCount > 0
              ? "inline-flex items-center gap-1 rounded-md border border-app-primary bg-app-primary px-2 py-1 text-xs font-medium text-app-primary-on"
              : "inline-flex items-center gap-1 rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover"
          }
        >
          {t("filterBy.sectionHide")}
          {activeCount > 0 && (
            <span className="rounded-full bg-app-primary-on/20 px-1.5 text-[10px] font-semibold leading-tight">
              {activeCount}
            </span>
          )}
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-app-border bg-app-surface p-2 shadow-lg">
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-app-text-muted">
              {t("filterBy.sectionHide")}
            </div>
            <ul>
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-app-surface-hover">
                  <input
                    type="checkbox"
                    checked={hideStale}
                    onChange={onToggleStale}
                    className="h-3.5 w-3.5 rounded border-app-border accent-app-primary"
                  />
                  <span className="text-app-text">{t("filterBy.stale")}</span>
                </label>
              </li>
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-app-surface-hover">
                  <input
                    type="checkbox"
                    checked={hideOrphaned}
                    onChange={onToggleOrphaned}
                    className="h-3.5 w-3.5 rounded border-app-border accent-app-primary"
                  />
                  <span className="text-app-text">{t("filterBy.orphaned")}</span>
                </label>
              </li>
            </ul>
            <p className="mt-2 px-2 text-[10px] leading-snug text-app-text-muted">
              {t("filterBy.staleDescription")}
            </p>
          </div>
        )}
      </div>
    </label>
  );
}
