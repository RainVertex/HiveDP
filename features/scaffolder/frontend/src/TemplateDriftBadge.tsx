import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DriftBadge } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { ScaffolderDriftSummaryDto } from "@internal/shared-types";

export interface TemplateDriftBadgeProps {
  /** Filter to a single binding (badge on BindingsPage rows). */
  bindingId?: string;
  /** Filter to all bindings of a template (aggregated badge on TemplatePage). */
  templateId?: string;
}

// Inline open-drift indicator for scaffolder bindings. Click to expand a list
// of open drifts per binding; each row exposes Replan (navigates to the
// resulting plan) and Ignore.
export function TemplateDriftBadge({ bindingId, templateId }: TemplateDriftBadgeProps) {
  const api = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState<ScaffolderDriftSummaryDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.scaffolder.driftSummary({ bindingId, templateId });
      setData(res);
    } catch {
      setData(null);
    }
  }, [api, bindingId, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.openCount === 0) return null;

  async function replan(bId: string) {
    setBusy(bId);
    setError(null);
    try {
      const plan = await api.scaffolder.replanBinding(bId);
      navigate(`/scaffolder/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replan failed");
    } finally {
      setBusy(null);
    }
  }

  async function ignore(driftId: string) {
    setBusy(driftId);
    setError(null);
    try {
      await api.scaffolder.updateDrift(driftId, "ignored");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DriftBadge count={data.openCount} label="drifted" severity="warn">
      <div className="space-y-3">
        {error && <div className="text-app-danger">{error}</div>}
        {data.byBinding.map((b) => (
          <div key={b.bindingId} className="space-y-1">
            <div className="font-mono text-app-text">{b.targetRef}</div>
            <div className="text-app-text-muted">{b.templateId}</div>
            {b.drifts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 pl-2">
                <div className="min-w-0 flex-1">
                  <span className="text-app-text">
                    {d.fromVersion} → {d.toVersion}
                  </span>{" "}
                  <span className="text-app-text-muted">
                    · {new Date(d.detectedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={busy === b.bindingId}
                    onClick={() => void replan(b.bindingId)}
                    className="rounded bg-app-primary px-2 py-0.5 text-[11px] text-app-primary-on disabled:opacity-50"
                  >
                    Replan
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
            ))}
          </div>
        ))}
      </div>
    </DriftBadge>
  );
}
