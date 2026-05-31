// Compact list of the most recent ServiceHealthSample rows.

import { useEffect, useState } from "react";
import type { ServiceHealthSample } from "@internal/shared-types";
import { useApi } from "@internal/api-client/react";

export interface ServiceHealthPanelProps {
  entityId?: string;
  limit?: number;
}

const STATUS_STYLE: Record<ServiceHealthSample["status"], string> = {
  healthy: "bg-app-success/20 text-app-success",
  degraded: "bg-app-warning/20 text-app-warning",
  down: "bg-app-danger/20 text-app-danger",
};

export function ServiceHealthPanel({ entityId, limit = 50 }: ServiceHealthPanelProps) {
  const api = useApi();
  const [items, setItems] = useState<ServiceHealthSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    const fetcher = entityId
      ? api.observability.healthSamplesForEntity(entityId)
      : api.observability.healthSamples();
    fetcher
      .then((res) => {
        if (!cancelled) setItems(res.items.slice(0, limit));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load samples");
      });
    return () => {
      cancelled = true;
    };
  }, [api, entityId, limit]);

  if (error) return <p className="text-xs text-app-danger">{error}</p>;
  if (items === null) return <p className="text-xs text-app-text-muted">Loading…</p>;
  if (items.length === 0)
    return (
      <p className="text-xs text-app-text-muted">
        No samples yet — wire up a Grafana integration to populate.
      </p>
    );

  return (
    <ul className="divide-y divide-app-border">
      {items.map((sample) => (
        <li key={sample.id} className="flex items-center gap-3 py-1.5 text-xs">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLE[sample.status]}`}
          >
            {sample.status}
          </span>
          <span className="grow truncate text-app-text-muted">{sample.entityId}</span>
          {sample.latencyMs != null && (
            <span className="shrink-0 text-app-text-muted">{sample.latencyMs}ms</span>
          )}
          {sample.errorRate != null && (
            <span className="shrink-0 text-app-text-muted">
              err {(sample.errorRate * 100).toFixed(2)}%
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
