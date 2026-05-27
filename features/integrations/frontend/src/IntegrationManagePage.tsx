// Unified per-integration manage page. Loads the detail (with per-kind safe
// config view) and renders the provider's ManagePanel. Generic actions
// (enable/disable, disconnect, back to list) live in this shell so each
// panel only owns its provider-specific controls.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog, PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { IntegrationDetail } from "@internal/shared-types";
import { findProvider } from "./providerRegistry";

export function IntegrationManagePage() {
  const api = useApi();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";

  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.integrations.get(id);
      setDetail(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integration");
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.integrations.setEnabled(detail.id, !detail.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!detail) return;
    setConfirmDisconnect(false);
    try {
      await api.integrations.disconnect(detail.id);
      navigate("/integrations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    }
  }

  const provider = detail ? findProvider(detail.kind) : undefined;
  const ManagePanel = provider?.ManagePanel;
  const title = detail ? detail.name : "Integration";
  const description = detail
    ? `${provider?.label ?? detail.kind} · ${detail.enabled ? "enabled" : "disabled"}`
    : undefined;

  return (
    <PageLayout
      title={title}
      description={description}
      actions={
        detail && (
          <>
            <button
              type="button"
              onClick={toggleEnabled}
              disabled={busy}
              className="rounded border border-app-border px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
            >
              {detail.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className="rounded px-2 py-1 text-xs text-app-danger hover:bg-app-surface-hover"
            >
              Disconnect
            </button>
          </>
        )
      }
    >
      <div className="mb-3">
        <Link to="/integrations" className="text-xs text-app-text-muted hover:underline">
          ← Back to integrations
        </Link>
      </div>

      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}
      {!detail && !error && <p className="text-sm text-app-text-muted">Loading…</p>}

      {detail && !ManagePanel && (
        <p className="text-sm text-app-text-muted">No configure surface for this provider yet.</p>
      )}

      {detail && ManagePanel && <ManagePanel integration={detail} onChanged={() => void load()} />}

      <ConfirmDialog
        open={confirmDisconnect}
        title={`Disconnect ${detail?.name ?? "integration"}?`}
        message="This deletes the local mirror data. The external tool itself is not affected."
        confirmLabel="Disconnect"
        destructive
        onConfirm={disconnect}
        onClose={() => setConfirmDisconnect(false)}
      />
    </PageLayout>
  );
}
