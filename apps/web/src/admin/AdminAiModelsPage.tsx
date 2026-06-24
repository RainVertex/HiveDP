import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { Trans, useTranslation } from "@internal/i18n";
import { useAdminAiApi } from "./adminAiClient";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  AdminAiModelRow,
} from "@feature/agents-shared";
import { useCurrentUser } from "../auth";

export function AdminAiModelsPage() {
  const client = useAdminAiApi();
  const me = useCurrentUser();
  const { t } = useTranslation();
  const [data, setData] = useState<AdminAiModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.listModels();
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
      await client.setModelEnabled(model.id, !model.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveDailyCap(model: AdminAiModelRow, cap: number | null) {
    setBusy(`cap:${model.id}`);
    setError(null);
    try {
      await client.setModelDailyCap(model.id, cap);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save cap");
    } finally {
      setBusy(null);
    }
  }

  async function saveKey(slug: string, apiKey: string) {
    setBusy(`key:${slug}`);
    setError(null);
    try {
      await client.setProviderKey(slug, apiKey);
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
      await client.clearProviderKey(slug);
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

  return (
    <PageLayout title={t("admin.aiModelsTitle")} description={t("admin.aiModelsDescription")}>
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-app-text-muted">{t("common.loading")}</div>
      ) : (
        <div className="grid gap-4">
          {data.providers.map((p) => (
            <ProviderCard
              key={p.slug}
              provider={p}
              busy={busy}
              onToggle={toggleEnabled}
              onSaveCap={saveDailyCap}
              onSaveKey={saveKey}
              onRemoveKey={removeKey}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

// Per-model daily token cap (input+output, per UTC day). Empty input means no cap.
function ModelCapEditor({
  model,
  busy,
  onSave,
}: {
  model: AdminAiModelRow;
  busy: boolean;
  onSave: (cap: number | null) => void;
}) {
  const stored = model.dailyTokenCap?.toString() ?? "";
  const [value, setValue] = useState(stored);
  const trimmed = value.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed > 0);
  const dirty = trimmed !== stored;

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        step={1000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="no cap"
        title="Daily token cap (input + output, per UTC day). Leave empty for no cap."
        className="w-28 rounded-md border border-app-border bg-app-bg-sunken px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
      />
      <span className="text-[10px] text-app-text-muted">tok/day</span>
      <button
        type="button"
        disabled={!dirty || !valid || busy}
        onClick={() => onSave(parsed)}
        className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onToggle,
  onSaveCap,
  onSaveKey,
  onRemoveKey,
}: {
  provider: AdminAiProviderGroup;
  busy: string | null;
  onToggle: (m: AdminAiModelRow) => void;
  onSaveCap: (m: AdminAiModelRow, cap: number | null) => void;
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
                  {m.supportsReasoning && (
                    <span className="ml-2 rounded-full border border-app-border px-1.5 py-0.5 text-[10px] text-app-text-muted">
                      reasoning
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-app-text-muted">{m.modelName}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ModelCapEditor
                  model={m}
                  busy={busy === `cap:${m.id}`}
                  onSave={(cap) => onSaveCap(m, cap)}
                />
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => onToggle(m)}
                  className="rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
                >
                  {m.enabled ? "Disable" : "Enable"}
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
              className="rounded-md bg-app-primary px-2.5 py-1 text-xs font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-50"
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
