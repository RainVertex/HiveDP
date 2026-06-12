// TanStack-based catalog table with status filtering, tag-group fan-out, and facet header filters.
import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type GroupingState,
  type Row,
} from "@tanstack/react-table";
import { useTranslation } from "@internal/i18n";
import {
  buildColumns,
  COLUMN_META,
  distinctValues,
  useLocalizedColumnMeta,
  type CatalogColumnId,
  type CatalogRow,
} from "./columns";
import { HeaderFilter } from "./HeaderFilter";
import type { CatalogView } from "./useCatalogView";

interface Props {
  data: CatalogRow[];
  view: CatalogView;
  onFilteredCountChange?: (n: number) => void;
}

function globalFilterFn(row: Row<CatalogRow>, _columnId: string, filterValue: string): boolean {
  if (!filterValue) return true;
  const q = filterValue.toLowerCase();
  const r = row.original;
  if (r.name.toLowerCase().includes(q)) return true;
  if (r.description && r.description.toLowerCase().includes(q)) return true;
  if (r.accessible && r.tags && r.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

export function CatalogTable({ data, view, onFilteredCountChange }: Props) {
  const { t } = useTranslation("catalog");
  const noOwnerLabel = t("placeholders.noOwner");
  const noTagsLabel = t("placeholders.noTags");
  const localizedMeta = useLocalizedColumnMeta();

  const columnHeaders = useMemo(
    () =>
      Object.fromEntries(Object.entries(localizedMeta).map(([id, m]) => [id, m.label])) as Record<
        CatalogColumnId,
        string
      >,
    [localizedMeta],
  );

  const columns = useMemo(
    () => buildColumns(noOwnerLabel, noTagsLabel, columnHeaders),
    [noOwnerLabel, noTagsLabel, columnHeaders],
  );

  // Status filters run before tag fan-out so a hidden entity does not ghost into multiple groups.
  const statusFiltered = useMemo<CatalogRow[]>(() => {
    if (!view.hideStale && !view.hideOrphaned) return data;
    return data.filter((r) => {
      if (!r.accessible) return true;
      if (view.hideStale && r.staleSince) return false;
      if (view.hideOrphaned && r.orphaned) return false;
      return true;
    });
  }, [data, view.hideStale, view.hideOrphaned]);

  // When grouping by tags, explode each entity into one row per tag so it can appear in multiple groups.
  const tableData = useMemo<CatalogRow[]>(() => {
    if (view.groupBy !== "tags") return statusFiltered;
    const out: CatalogRow[] = [];
    for (const r of statusFiltered) {
      if (!r.accessible || !r.tags || r.tags.length === 0) {
        out.push(r.accessible ? { ...r, tags: [noTagsLabel] } : r);
      } else {
        for (const tg of r.tags) out.push({ ...r, tags: [tg] });
      }
    }
    return out;
  }, [statusFiltered, view.groupBy, noTagsLabel]);

  const grouping = useMemo<GroupingState>(
    () => (view.groupBy ? [view.groupBy] : []),
    [view.groupBy],
  );

  const table = useReactTable<CatalogRow>({
    data: tableData,
    columns,
    state: {
      sorting: view.sorting,
      grouping,
      columnVisibility: view.visibility,
      columnFilters: view.columnFilters,
      globalFilter: view.search,
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(view.sorting) : updater;
      view.setSorting(next);
    },
    enableExpanding: true,
    autoResetExpanded: false,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const filteredCount =
    view.groupBy === "tags"
      ? new Set(table.getFilteredRowModel().rows.map((r) => r.original.id)).size
      : table.getFilteredRowModel().rows.length;

  if (onFilteredCountChange) onFilteredCountChange(filteredCount);

  const facetOptions = useMemo(() => {
    const m: Partial<Record<CatalogColumnId, string[]>> = {};
    for (const id of Object.keys(COLUMN_META) as CatalogColumnId[]) {
      if (COLUMN_META[id].filterKind === "facet") {
        m[id] = distinctValues(data, id, noOwnerLabel, noTagsLabel);
      }
    }
    return m;
  }, [data, noOwnerLabel, noTagsLabel]);

  return (
    <div className="overflow-x-auto rounded-lg border border-app-border bg-app-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-app-border bg-app-surface">
          {table.getHeaderGroups().map((hg) => (
            <tr
              key={hg.id}
              className="text-left text-xs uppercase tracking-wide text-app-text-muted"
            >
              {hg.headers.map((header) => {
                const colId = header.column.id as CatalogColumnId;
                const meta = localizedMeta[colId];
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <th key={header.id} className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canSort}
                        onClick={() => canSort && header.column.toggleSorting()}
                        className={`flex items-center gap-1 ${canSort ? "hover:text-app-text" : ""}`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDir === "asc" && <span>↑</span>}
                        {sortDir === "desc" && <span>↓</span>}
                      </button>
                      {meta.filterKind === "facet" && (
                        <HeaderFilter
                          column={colId}
                          options={facetOptions[colId] ?? []}
                          selected={view.facets[colId] ?? []}
                          onToggle={(v) => view.toggleFacet(colId, v)}
                          onClear={() => view.clearFacet(colId)}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            if (row.getIsGrouped()) {
              const groupValue = String(row.getValue(view.groupBy as string) ?? "—");
              const count =
                view.groupBy === "tags"
                  ? new Set(row.subRows.map((s) => s.original.id)).size
                  : row.subRows.length;
              return (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-app-border bg-app-surface-hover hover:bg-app-surface-hover/80"
                  onClick={row.getToggleExpandedHandler()}
                >
                  <td colSpan={row.getVisibleCells().length} className="px-4 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-app-text-muted">{row.getIsExpanded() ? "▾" : "▸"}</span>
                      <span className="font-medium text-app-text">{groupValue}</span>
                      <span className="text-app-text-muted">({count})</span>
                    </div>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={row.id} className="border-t border-app-border hover:bg-app-surface-hover/50">
                {row.getVisibleCells().map((cell) => {
                  const isPlaceholder = cell.getIsPlaceholder();
                  // Grouped column on a leaf row renders an indent spacer.
                  if (isPlaceholder && cell.column.id === view.groupBy) {
                    return <td key={cell.id} className="px-4 py-3" />;
                  }
                  return (
                    <td key={cell.id} className="px-4 py-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
