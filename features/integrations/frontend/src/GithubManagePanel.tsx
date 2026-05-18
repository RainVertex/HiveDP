// Thin GitHub configure surface. Surfaces basic install identity and a manual
// Resync trigger. Per-team sync state and stale-team warnings are rendered
// inline on the Integrations list page via IntegrationDriftBadge.

import { useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { IntegrationDetail } from "@internal/shared-types";

export interface GithubManagePanelProps {
  integration: IntegrationDetail;
  onChanged: () => void;
}

export function GithubManagePanel({ integration, onChanged }: GithubManagePanelProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (integration.kind !== "github") return null;
  const cfg = integration.config;

  async function resync() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await api.integrations.githubResync(integration.id);
      const counts = `${res.teamsCreated}+/${res.teamsUpdated}~/${res.teamsDeleted}-, members ${res.membersAdded}+/${res.membersRemoved}-`;
      setStatus(`Resync ok — teams ${counts}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-app-danger">{error}</p>}
      {status && <p className="text-sm text-app-text">{status}</p>}

      <section className="space-y-2 rounded-md border border-app-border bg-app-surface p-3">
        <h3 className="text-sm font-semibold text-app-text">Installation</h3>
        <Row label="Org" value={cfg.accountLogin || "—"} />
        <Row label="Installation id" value={String(cfg.installationId || "—")} />
      </section>

      <section className="space-y-2 rounded-md border border-app-border bg-app-surface p-3">
        <h3 className="text-sm font-semibold text-app-text">Sync</h3>
        <p className="text-xs text-app-text-muted">Run a manual reconciliation now.</p>
        <button
          type="button"
          onClick={resync}
          disabled={busy}
          className="rounded border border-app-border px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Resync now"}
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-app-text-muted">{label}</span>
      <span className="break-all text-right text-app-text">{value}</span>
    </div>
  );
}
