// Tracks page-visit counts in localStorage and exposes recent/top-visited hooks.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation } from "react-router-dom";
import { VISITS_STORAGE_KEY, type VisitRecord } from "./types";

const EXCLUDED_PATHS = new Set(["/", "/settings"]);
const MAX_RECORDS = 50;

function readStored(): Record<string, VisitRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VISITS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, VisitRecord>;
  } catch {
    return {};
  }
}

interface VisitContextValue {
  visits: Record<string, VisitRecord>;
  clear: () => void;
}

const VisitContext = createContext<VisitContextValue | null>(null);

export function VisitTrackerProvider({ children }: PropsWithChildren) {
  const [visits, setVisits] = useState<Record<string, VisitRecord>>(() => readStored());
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    if (EXCLUDED_PATHS.has(path)) return;

    setVisits((prev) => {
      const existing = prev[path];
      const next: VisitRecord = {
        path,
        count: (existing?.count ?? 0) + 1,
        lastVisit: Date.now(),
      };
      const merged = { ...prev, [path]: next };

      const entries = Object.values(merged).sort((a, b) => b.lastVisit - a.lastVisit);
      if (entries.length > MAX_RECORDS) {
        const trimmed: Record<string, VisitRecord> = {};
        for (const entry of entries.slice(0, MAX_RECORDS)) trimmed[entry.path] = entry;
        return trimmed;
      }
      return merged;
    });
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VISITS_STORAGE_KEY, JSON.stringify(visits));
    } catch {
      /* ignore */
    }
  }, [visits]);

  const clear = useCallback(() => setVisits({}), []);

  const value = useMemo<VisitContextValue>(() => ({ visits, clear }), [visits, clear]);
  return <VisitContext.Provider value={value}>{children}</VisitContext.Provider>;
}

export function useVisits(): VisitContextValue {
  const ctx = useContext(VisitContext);
  if (!ctx) throw new Error("useVisits must be used inside <VisitTrackerProvider>");
  return ctx;
}

export function useRecentlyVisited(limit = 5): VisitRecord[] {
  const { visits } = useVisits();
  return useMemo(
    () =>
      Object.values(visits)
        .sort((a, b) => b.lastVisit - a.lastVisit)
        .slice(0, limit),
    [visits, limit],
  );
}

export function useTopVisited(limit = 5): VisitRecord[] {
  const { visits } = useVisits();
  return useMemo(
    () =>
      Object.values(visits)
        .sort((a, b) => b.count - a.count || b.lastVisit - a.lastVisit)
        .slice(0, limit),
    [visits, limit],
  );
}
