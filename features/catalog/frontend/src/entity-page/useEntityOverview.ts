import { useCallback, useEffect, useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { CatalogEntityOverviewResponse } from "@internal/shared-types";

export interface UseEntityOverviewResult {
  data: CatalogEntityOverviewResponse | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useEntityOverview(id: string): UseEntityOverviewResult {
  const api = useApi();
  const [data, setData] = useState<CatalogEntityOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    api.catalog
      .overview(id)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load entity");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  useEffect(() => load(), [load]);

  return { data, error, loading, reload: load };
}
