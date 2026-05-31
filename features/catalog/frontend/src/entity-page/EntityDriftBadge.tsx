import { useState } from "react";
import { DriftBadge } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { CatalogEntityOverview } from "@internal/shared-types";

export interface EntityDriftBadgeProps {
  data: CatalogEntityOverview;
  reload: () => void;
}

// Open-drift indicator for an entity; reads drifts from the already-loaded overview (no extra fetch).
export function EntityDriftBadge({ data, reload }: EntityDriftBadgeProps) {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDrifts = data.drifts.filter((d) => d.status === "open");
  if (data.openDriftCount === 0) return null;

  async function apply(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.catalog.applyDrift(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(null);
    }
  }

  async function ignore(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.catalog.ignoreDrift(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ignore failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DriftBadge count={data.openDriftCount} label="drifted" severity="warn">
      <div className="space-y-2">
        {error && <div className="text-app-danger">{error}</div>}
        {openDrifts.map((d) => {
          const diff = d.diff as { fields?: string[] } | null;
          return (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-app-text">{d.kind}</div>
                <div className="text-app-text-muted">
                  proposed by {d.proposedBy} · {new Date(d.detectedAt).toLocaleDateString()}
                </div>
                {diff?.fields && diff.fields.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {diff.fields.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-app-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-app-text-muted"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => void apply(d.id)}
                  className="rounded bg-app-primary px-2 py-0.5 text-[11px] text-app-primary-on disabled:opacity-50"
                >
                  Apply
                </button>
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => void ignore(d.id)}
                  className="rounded border border-app-border px-2 py-0.5 text-[11px] text-app-text-muted hover:bg-app-surface-hover disabled:opacity-50"
                >
                  Ignore
                </button>
              </div>
            </div>
          );
        })}
        {data.openDriftCount > openDrifts.length && (
          <div className="text-app-text-muted">
            {data.openDriftCount - openDrifts.length} more open drift(s) not shown.
          </div>
        )}
      </div>
    </DriftBadge>
  );
}
