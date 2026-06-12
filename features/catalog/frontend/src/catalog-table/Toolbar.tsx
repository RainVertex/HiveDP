import { useTranslation } from "@internal/i18n";
import { ColumnsPopover } from "./ColumnsPopover";
import { FilterByPopover } from "./FilterByPopover";
import { FilterChip } from "./FilterChip";
import { GroupBySelect } from "./GroupBySelect";
import { COLUMN_META, type CatalogColumnId } from "./columns";
import type { CatalogView } from "./useCatalogView";

interface Props {
  view: CatalogView;
  total: number;
  filtered: number;
}

export function Toolbar({ view, total, filtered }: Props) {
  const { t } = useTranslation("catalog");
  const activeFacets = Object.entries(view.facets).filter(([, v]) => v && v.length > 0) as Array<
    [CatalogColumnId, string[]]
  >;
  const hasState =
    view.search ||
    view.groupBy ||
    view.sorting.length > 0 ||
    activeFacets.length > 0 ||
    view.hideStale ||
    view.hideOrphaned ||
    view.visibleColumns.length !==
      Object.values(COLUMN_META).filter((m) => m.defaultVisible).length;

  const countLabel =
    filtered === total
      ? t("toolbar.entitiesCount_other", { count: total })
      : t("toolbar.entitiesFiltered", { filtered, total });

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <input
            type="search"
            value={view.search}
            onChange={(e) => view.setSearch(e.target.value)}
            placeholder={t("toolbar.searchPlaceholder")}
            className="w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
        </div>
        <GroupBySelect value={view.groupBy} onChange={view.setGroupBy} />
        <FilterByPopover
          hideStale={view.hideStale}
          hideOrphaned={view.hideOrphaned}
          onToggleStale={() => view.setHideStale(!view.hideStale)}
          onToggleOrphaned={() => view.setHideOrphaned(!view.hideOrphaned)}
        />
        <ColumnsPopover visibleColumns={view.visibleColumns} onToggle={view.toggleColumn} />
        {hasState && (
          <button
            type="button"
            onClick={view.reset}
            className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-text-muted hover:bg-app-surface-hover"
          >
            {t("toolbar.reset")}
          </button>
        )}
        <span className="ml-auto text-xs text-app-text-muted">{countLabel}</span>
      </div>
      {activeFacets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFacets.flatMap(([col, values]) =>
            values.map((v) => (
              <FilterChip
                key={`${col}:${v}`}
                column={col}
                value={v}
                onRemove={() => view.toggleFacet(col, v)}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}
