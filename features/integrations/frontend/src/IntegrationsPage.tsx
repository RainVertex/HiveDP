import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout, ConfirmDialog } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { Integration, IntegrationKind } from "@internal/shared-types";
import { IntegrationDriftBadge } from "./IntegrationDriftBadge";
import { PROVIDERS, findProvider } from "./providerRegistry";

export function IntegrationsPage() {
  const api = useApi();
  const [items, setItems] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectKind, setConnectKind] = useState<IntegrationKind | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Integration | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.integrations.list();
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const ActiveConnectDialog = connectKind ? findProvider(connectKind)?.ConnectDialog : undefined;

  return (
    <PageLayout title="Integrations" description="External tools mirrored into the platform.">
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-app-text">Connected</h2>
        {!error && items === null && <p className="text-sm text-app-text-muted">Loading…</p>}
        {items && items.length === 0 && (
          <p className="text-sm text-app-text-muted">
            Nothing connected yet. Pick a provider below to get started.
          </p>
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-app-border rounded-md border border-app-border">
            {items.map((integration) => {
              const provider = findProvider(integration.kind);
              return (
                <li key={integration.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-app-text">{integration.name}</div>
                      <div className="text-xs text-app-text-muted">
                        {provider?.label ?? integration.kind} ·{" "}
                        {integration.enabled ? "enabled" : "disabled"}
                      </div>
                    </div>
                    <IntegrationDriftBadge integrationId={integration.id} kind={integration.kind} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/integrations/${integration.id}`}
                      className="rounded border border-app-border px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover"
                    >
                      Configure
                    </Link>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(integration)}
                      className="rounded px-2 py-1 text-xs text-app-danger hover:bg-app-surface-hover"
                    >
                      Disconnect
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-app-text">Available providers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const available = provider.ConnectDialog !== undefined;
            return (
              <div
                key={provider.kind}
                className="flex flex-col rounded-md border border-app-border bg-app-surface p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-app-text">{provider.label}</span>
                  {!available && (
                    <span className="rounded bg-app-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mb-3 flex-1 text-xs text-app-text-muted">{provider.description}</p>
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => setConnectKind(provider.kind)}
                  className="self-start rounded bg-app-primary px-2.5 py-1 text-xs font-medium text-app-primary-on disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Connect
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {ActiveConnectDialog && (
        <ActiveConnectDialog
          open={connectKind !== null}
          onClose={() => setConnectKind(null)}
          onConnected={() => void load()}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Disconnect ${pendingDelete?.name ?? "integration"}?`}
        message="This deletes the local mirror data. The external tool itself is not affected."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await api.integrations.disconnect(pendingDelete.id);
            setPendingDelete(null);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Disconnect failed");
            setPendingDelete(null);
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </PageLayout>
  );
}
