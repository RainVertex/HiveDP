// Inline GitHub drift indicator with a manual resync; hidden for non-admins and non-github kinds.

import { useCallback, useEffect, useState } from "react";
import { DriftBadge } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { GithubDriftSummaryDto } from "@internal/shared-types";

export interface IntegrationDriftBadgeProps {
  integrationId: string;
  kind: string;
}

export function IntegrationDriftBadge({ integrationId, kind }: IntegrationDriftBadgeProps) {
  const api = useApi();
  const [data, setData] = useState<GithubDriftSummaryDto | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (kind !== "github") return;
    try {
      const res = await api.integrations.githubDrift(integrationId);
      setData(res);
    } catch {
      setData(null);
    }
  }, [api, integrationId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  if (kind !== "github" || !data) return null;
  const count = data.staleTeamCount + (data.pendingMemberCount > 0 ? 1 : 0);
  if (count === 0) return null;

  async function resync() {
    setResyncing(true);
    setError(null);
    try {
      await api.integrations.githubResync(integrationId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resync failed");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <DriftBadge count={data.staleTeamCount} label="stale teams" severity="warn">
      <div className="space-y-2">
        <div className="text-app-text-muted">
          Last reconciliation:{" "}
          {data.lastReconciliationAt
            ? new Date(data.lastReconciliationAt).toLocaleString()
            : "never"}
        </div>
        {data.staleTeams.length > 0 && (
          <ul className="space-y-1">
            {data.staleTeams.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="text-app-text">{t.name}</span>
                <span className="text-app-text-muted">
                  {t.lastSyncedAt ? new Date(t.lastSyncedAt).toLocaleDateString() : "never"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.pendingMemberCount > 0 && (
          <div className="text-app-text-muted">
            {data.pendingMemberCount} pending team memberships awaiting SSO sign-in.
          </div>
        )}
        {error && <div className="text-app-danger">{error}</div>}
        <button
          type="button"
          onClick={() => void resync()}
          disabled={resyncing}
          className="rounded border border-app-border px-2 py-1 text-app-text hover:bg-app-surface-hover disabled:opacity-50"
        >
          {resyncing ? "Resyncing…" : "Resync now"}
        </button>
      </div>
    </DriftBadge>
  );
}
