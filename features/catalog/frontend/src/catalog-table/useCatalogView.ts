// Hook syncing catalog table view state (search, sort, facets, columns) with URL params and localStorage.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";
import { COLUMN_META, COLUMN_ORDER, PINNED_COLUMN, type CatalogColumnId } from "./columns";

const STORAGE_KEY = "catalog.view";

type FacetState = Partial<Record<CatalogColumnId, string[]>>;

interface PersistedView {
  q?: string;
  g?: CatalogColumnId | null;
  s?: { id: CatalogColumnId; desc: boolean } | null;
  cols?: CatalogColumnId[];
  facets?: FacetState;
  hs?: boolean;
  ho?: boolean;
  ao?: boolean;
}

export interface CatalogView {
  search: string;
  groupBy: CatalogColumnId | null;
  sorting: SortingState;
  visibleColumns: CatalogColumnId[];
  visibility: VisibilityState;
  columnFilters: ColumnFiltersState;
  facets: FacetState;
  hideStale: boolean;
  hideOrphaned: boolean;
  showAllOrgs: boolean;
  setSearch: (v: string) => void;
  setGroupBy: (id: CatalogColumnId | null) => void;
  setSorting: (s: SortingState) => void;
  toggleColumn: (id: CatalogColumnId) => void;
  toggleFacet: (col: CatalogColumnId, value: string) => void;
  clearFacet: (col: CatalogColumnId) => void;
  setHideStale: (v: boolean) => void;
  setHideOrphaned: (v: boolean) => void;
  setShowAllOrgs: (v: boolean) => void;
  reset: () => void;
}

const KNOWN_IDS = new Set<string>(COLUMN_ORDER);

function asColumnId(v: string | null | undefined): CatalogColumnId | null {
  return v && KNOWN_IDS.has(v) ? (v as CatalogColumnId) : null;
}

function defaultVisible(): CatalogColumnId[] {
  return COLUMN_ORDER.filter((id) => COLUMN_META[id].defaultVisible);
}

function parseSort(raw: string | null): SortingState {
  if (!raw) return [];
  const [id, dir] = raw.split(":");
  const colId = asColumnId(id);
  if (!colId) return [];
  return [{ id: colId, desc: dir === "desc" }];
}

function parseColumns(raw: string | null): CatalogColumnId[] | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => asColumnId(s.trim()))
    .filter((s): s is CatalogColumnId => s !== null);
  if (ids.length === 0) return null;
  if (!ids.includes(PINNED_COLUMN)) ids.unshift(PINNED_COLUMN);
  return ids;
}

function readStorage(): PersistedView {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedView) : {};
  } catch {
    return {};
  }
}

function writeStorage(view: PersistedView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // ignore quota / privacy mode
  }
}

function snapshotFromParams(p: URLSearchParams): PersistedView {
  const cols = parseColumns(p.get("cols")) ?? undefined;
  const facets: FacetState = {};
  for (const [key, value] of p.entries()) {
    if (!key.startsWith("f.")) continue;
    const col = asColumnId(key.slice(2));
    if (!col) continue;
    (facets[col] ??= []).push(value);
  }
  const sortRaw = p.get("s");
  let s: PersistedView["s"] = null;
  if (sortRaw) {
    const [id, dir] = sortRaw.split(":");
    const colId = asColumnId(id);
    if (colId) s = { id: colId, desc: dir === "desc" };
  }
  return {
    q: p.get("q") ?? undefined,
    g: asColumnId(p.get("g")),
    s,
    cols,
    facets,
    hs: p.get("hs") === "1" || undefined,
    ho: p.get("ho") === "1" || undefined,
    ao: p.get("ao") === "1" || undefined,
  };
}

export function useCatalogView(): CatalogView {
  const [params, setParams] = useSearchParams();
  const seededRef = useRef(false);

  // On first mount with an empty URL, hydrate from localStorage to restore the last view.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (Array.from(params.keys()).length > 0) return;
    const stored = readStorage();
    const next = new URLSearchParams();
    if (stored.q) next.set("q", stored.q);
    if (stored.g) next.set("g", stored.g);
    if (stored.s) next.set("s", `${stored.s.id}:${stored.s.desc ? "desc" : "asc"}`);
    if (stored.cols && stored.cols.length > 0) next.set("cols", stored.cols.join(","));
    if (stored.facets) {
      for (const [col, values] of Object.entries(stored.facets)) {
        if (!values) continue;
        for (const v of values) next.append(`f.${col}`, v);
      }
    }
    if (stored.hs) next.set("hs", "1");
    if (stored.ho) next.set("ho", "1");
    if (stored.ao) next.set("ao", "1");
    if (Array.from(next.keys()).length > 0) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = params.get("q") ?? "";
  const groupBy = asColumnId(params.get("g"));
  const sorting = parseSort(params.get("s"));
  const hideStale = params.get("hs") === "1";
  const hideOrphaned = params.get("ho") === "1";
  const showAllOrgs = params.get("ao") === "1";

  const visibleColumns = useMemo<CatalogColumnId[]>(
    () => parseColumns(params.get("cols")) ?? defaultVisible(),
    [params],
  );

  const visibility = useMemo<VisibilityState>(() => {
    const set = new Set(visibleColumns);
    const v: VisibilityState = {};
    for (const id of COLUMN_ORDER) v[id] = set.has(id);
    v[PINNED_COLUMN] = true;
    return v;
  }, [visibleColumns]);

  const facets = useMemo<FacetState>(() => {
    const out: FacetState = {};
    for (const [key, value] of params.entries()) {
      if (!key.startsWith("f.")) continue;
      const col = asColumnId(key.slice(2));
      if (!col) continue;
      (out[col] ??= []).push(value);
    }
    return out;
  }, [params]);

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    return Object.entries(facets)
      .filter(([, v]) => v && v.length > 0)
      .map(([id, value]) => ({ id, value: value as string[] }));
  }, [facets]);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          writeStorage(snapshotFromParams(next));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setSearch = useCallback(
    (v: string) => update((n) => (v ? n.set("q", v) : n.delete("q"))),
    [update],
  );

  const setGroupBy = useCallback(
    (id: CatalogColumnId | null) => update((n) => (id ? n.set("g", id) : n.delete("g"))),
    [update],
  );

  const setSorting = useCallback(
    (s: SortingState) => {
      update((n) => {
        if (s.length === 0) return n.delete("s");
        const [first] = s;
        const colId = asColumnId(first.id);
        if (!colId) return n.delete("s");
        n.set("s", `${colId}:${first.desc ? "desc" : "asc"}`);
      });
    },
    [update],
  );

  const toggleColumn = useCallback(
    (id: CatalogColumnId) => {
      if (id === PINNED_COLUMN) return;
      const isVisible = visibleColumns.includes(id);
      const nextVisible = isVisible
        ? visibleColumns.filter((c) => c !== id)
        : COLUMN_ORDER.filter((c) => visibleColumns.includes(c) || c === id);
      update((n) => {
        // Persist only when it differs from defaults, to keep the URL clean.
        const dflt = defaultVisible();
        const same =
          nextVisible.length === dflt.length && nextVisible.every((c, i) => c === dflt[i]);
        if (same) n.delete("cols");
        else n.set("cols", nextVisible.join(","));
      });
    },
    [visibleColumns, update],
  );

  const toggleFacet = useCallback(
    (col: CatalogColumnId, value: string) => {
      update((n) => {
        const key = `f.${col}`;
        const current = n.getAll(key);
        n.delete(key);
        if (current.includes(value)) {
          for (const v of current.filter((x) => x !== value)) n.append(key, v);
        } else {
          for (const v of current) n.append(key, v);
          n.append(key, value);
        }
      });
    },
    [update],
  );

  const clearFacet = useCallback(
    (col: CatalogColumnId) => update((n) => n.delete(`f.${col}`)),
    [update],
  );

  const setHideStale = useCallback(
    (v: boolean) => update((n) => (v ? n.set("hs", "1") : n.delete("hs"))),
    [update],
  );

  const setHideOrphaned = useCallback(
    (v: boolean) => update((n) => (v ? n.set("ho", "1") : n.delete("ho"))),
    [update],
  );

  const setShowAllOrgs = useCallback(
    (v: boolean) => update((n) => (v ? n.set("ao", "1") : n.delete("ao"))),
    [update],
  );

  const reset = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
    writeStorage({});
  }, [setParams]);

  return {
    search,
    groupBy,
    sorting,
    visibleColumns,
    visibility,
    columnFilters,
    facets,
    hideStale,
    hideOrphaned,
    showAllOrgs,
    setSearch,
    setGroupBy,
    setSorting,
    toggleColumn,
    toggleFacet,
    clearFacet,
    setHideStale,
    setHideOrphaned,
    setShowAllOrgs,
    reset,
  };
}
