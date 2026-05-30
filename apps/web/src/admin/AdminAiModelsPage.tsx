import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  AdminAiModelRow,
} from "@internal/shared-types";
import { useCurrentUser } from "../auth";

export function AdminAiModelsPage() {
  const client = useApi();
  const me = useCurrentUser();
  const [data, setData] = useState<AdminAiModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.adminAi.listModels();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(model: AdminAiModelRow) {
    setBusy(model.id);
    setError(null);
    try {
      await client.adminAi.setModelEnabled(model.id, !model.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function setActive(modelId: string | null) {
    setBusy(modelId ?? "clear");
    setError(null);
    try {
      await client.adminAi.setActiveChatModel(modelId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set active model");
    } finally {
      setBusy(null);
    }
  }

  if (me.role !== "admin") {
    return (
      <PageLayout title="AI / Models" description="Admin only.">
        <div className="text-sm text-app-text-muted">
          You need the <strong>admin</strong> role to view this page.
        </div>
      </PageLayout>
    );
  }

  const activeId = data?.activeChatModelId ?? null;

  return (
    <PageLayout
      title="AI / Models"
      description="Supported models, provider readiness, and the active chat model. The assistant stays unavailable until you select a tool-capable model from a ready provider."
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-app-text-muted">
              Active chat model
            </div>
            <div className="text-sm text-app-text">
              {activeId ? (
                findModelName(data, activeId)
              ) : (
                <span className="text-app-warning">
                  Not configured — chat is unavailable to users.
                </span>
              )}
            </div>
          </div>
          {activeId && (
            <button
              type="button"
              disabled={busy === "clear"}
              onClick={() => void setActive(null)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50"
            >
              Clear active model
            </button>
          )}
        </div>
      </section>

      {!data ? (
        <div className="text-sm text-app-text-muted">Loading…</div>
      ) : (
        <div className="grid gap-4">
          {data.providers.map((p) => (
            <ProviderCard
              key={p.slug}
              provider={p}
              activeId={activeId}
              busy={busy}
              onToggle={toggleEnabled}
              onSetActive={setActive}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function findModelName(data: AdminAiModelsResponse | null, id: string): string {
  if (!data) return id;
  for (const p of data.providers) {
    const m = p.models.find((x) => x.id === id);
    if (m) return `${m.displayName} (${p.displayName})`;
  }
  return id;
}

function ProviderCard({
  provider,
  activeId,
  busy,
  onToggle,
  onSetActive,
}: {
  provider: AdminAiProviderGroup;
  activeId: string | null;
  busy: string | null;
  onToggle: (m: AdminAiModelRow) => void;
  onSetActive: (id: string) => void;
}) {
  const readinessLabel = provider.apiKeyEnvVar
    ? provider.ready
      ? `${provider.apiKeyEnvVar} present`
      : `Missing ${provider.apiKeyEnvVar}`
    : "Local, no key needed";

  return (
    <section className="rounded-lg border border-app-border bg-app-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-medium text-app-text">{provider.displayName}</div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            provider.ready
              ? "bg-app-success/10 text-app-success"
              : "bg-app-danger/10 text-app-danger"
          }`}
        >
          {readinessLabel}
        </span>
      </div>

      <div className="grid gap-2">
        {provider.models.map((m) => {
          const isActive = m.id === activeId;
          const canActivate = provider.ready && m.enabled && m.supportsTools;
          const activateTitle = !provider.ready
            ? "Provider is not ready"
            : !m.enabled
              ? "Enable the model first"
              : !m.supportsTools
                ? "Chat needs a tool-capable model"
                : "Set as active chat model";
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-app-border bg-app-bg-sunken px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm text-app-text">
                  {m.displayName}
                  {!m.supportsTools && (
                    <span className="ml-2 rounded-full border border-app-border px-1.5 py-0.5 text-[10px] text-app-text-muted">
                      no tools
                    </span>
                  )}
                  {isActive && (
                    <span className="ml-2 rounded-full bg-app-primary/10 px-1.5 py-0.5 text-[10px] text-app-primary">
                      active chat model
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-app-text-muted">{m.modelName}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => onToggle(m)}
                  className="rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
                >
                  {m.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  disabled={!canActivate || isActive || busy === m.id}
                  title={activateTitle}
                  onClick={() => onSetActive(m.id)}
                  className="rounded-md bg-app-primary px-2.5 py-1 text-xs font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
                >
                  {isActive ? "Active" : "Set as chat model"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
