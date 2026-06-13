import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { Trans, useTranslation } from "@internal/i18n";
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
  const { t } = useTranslation();
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

  async function setActiveVision(modelId: string | null) {
    setBusy(`vision:${modelId ?? "clear"}`);
    setError(null);
    try {
      await client.adminAi.setActiveVisionModel(modelId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set vision model");
    } finally {
      setBusy(null);
    }
  }

  async function saveKey(slug: string, apiKey: string) {
    setBusy(`key:${slug}`);
    setError(null);
    try {
      await client.adminAi.setProviderKey(slug, apiKey);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(slug: string) {
    setBusy(`key:${slug}`);
    setError(null);
    try {
      await client.adminAi.clearProviderKey(slug);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setBusy(null);
    }
  }

  if (me.role !== "admin") {
    return (
      <PageLayout title={t("admin.aiModelsTitle")} description={t("common.adminOnly")}>
        <div className="text-sm text-app-text-muted">
          <Trans i18nKey="forbidden.body" components={{ strong: <strong /> }} />
        </div>
      </PageLayout>
    );
  }

  const activeId = data?.activeChatModelId ?? null;
  const activeVisionId = data?.activeVisionModelId ?? null;

  return (
    <PageLayout title={t("admin.aiModelsTitle")} description={t("admin.aiModelsDescription")}>
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
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

        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-app-text-muted">
                Active vision model
              </div>
              <div className="text-sm text-app-text">
                {activeVisionId ? (
                  findModelName(data, activeVisionId)
                ) : (
                  <span className="text-app-text-muted">
                    Not configured, image input in chat is disabled.
                  </span>
                )}
              </div>
            </div>
            {activeVisionId && (
              <button
                type="button"
                disabled={busy === "vision:clear"}
                onClick={() => void setActiveVision(null)}
                className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover disabled:opacity-50"
              >
                Clear vision model
              </button>
            )}
          </div>
        </section>
      </div>

      {!data ? (
        <div className="text-sm text-app-text-muted">{t("common.loading")}</div>
      ) : (
        <div className="grid gap-4">
          {data.providers.map((p) => (
            <ProviderCard
              key={p.slug}
              provider={p}
              activeId={activeId}
              activeVisionId={activeVisionId}
              busy={busy}
              onToggle={toggleEnabled}
              onSetActive={setActive}
              onSetActiveVision={setActiveVision}
              onSaveKey={saveKey}
              onRemoveKey={removeKey}
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
  activeVisionId,
  busy,
  onToggle,
  onSetActive,
  onSetActiveVision,
  onSaveKey,
  onRemoveKey,
}: {
  provider: AdminAiProviderGroup;
  activeId: string | null;
  activeVisionId: string | null;
  busy: string | null;
  onToggle: (m: AdminAiModelRow) => void;
  onSetActive: (id: string) => void;
  onSetActiveVision: (id: string) => void;
  onSaveKey: (slug: string, apiKey: string) => void;
  onRemoveKey: (slug: string) => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const keyStatus = !provider.apiKeyEnvVar
    ? "Local, no key needed"
    : provider.hasStoredKey
      ? "Key set in app"
      : provider.ready
        ? `Key set via ${provider.apiKeyEnvVar}`
        : `No key (${provider.apiKeyEnvVar})`;

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
          {keyStatus}
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
          const isActiveVision = m.id === activeVisionId;
          const canActivateVision = provider.ready && m.enabled && m.supportsVision;
          const activateVisionTitle = !provider.ready
            ? "Provider is not ready"
            : !m.enabled
              ? "Enable the model first"
              : !m.supportsVision
                ? "Image extraction needs a vision-capable model"
                : "Set as active vision model";
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
                  {m.supportsVision && (
                    <span className="ml-2 rounded-full border border-app-border px-1.5 py-0.5 text-[10px] text-app-text-muted">
                      vision
                    </span>
                  )}
                  {isActive && (
                    <span className="ml-2 rounded-full bg-app-primary/10 px-1.5 py-0.5 text-[10px] text-app-primary">
                      active chat model
                    </span>
                  )}
                  {isActiveVision && (
                    <span className="ml-2 rounded-full bg-app-primary/10 px-1.5 py-0.5 text-[10px] text-app-primary">
                      active vision model
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
                  disabled={!canActivateVision || isActiveVision || busy === `vision:${m.id}`}
                  title={activateVisionTitle}
                  onClick={() => onSetActiveVision(m.id)}
                  className="rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
                >
                  {isActiveVision ? "Vision" : "Set as vision model"}
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

      {provider.apiKeyEnvVar && (
        <div className="mt-3 border-t border-app-border pt-3">
          <div className="mb-1 text-xs text-app-text-muted">API key</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={
                provider.hasStoredKey ? "Replace key…" : `Paste ${provider.apiKeyEnvVar}…`
              }
              className="min-w-0 flex-1 rounded-md border border-app-border bg-app-bg-sunken px-2 py-1 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
            />
            <button
              type="button"
              disabled={!keyInput.trim() || busy === `key:${provider.slug}`}
              onClick={() => {
                onSaveKey(provider.slug, keyInput.trim());
                setKeyInput("");
              }}
              className="rounded-md bg-app-primary px-2.5 py-1 text-xs font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
            >
              Save key
            </button>
            {provider.hasStoredKey && (
              <button
                type="button"
                disabled={busy === `key:${provider.slug}`}
                onClick={() => onRemoveKey(provider.slug)}
                className="rounded-md border border-app-danger px-2.5 py-1 text-xs text-app-danger hover:bg-app-danger/10 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
