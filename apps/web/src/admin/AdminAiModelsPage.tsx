import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { Trans, useTranslation } from "@internal/i18n";
import { useApi } from "@internal/api-client/react";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  AdminAiModelRow,
  ChatSourceRepoDto,
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

  return (
    <PageLayout title={t("admin.aiModelsTitle")} description={t("admin.aiModelsDescription")}>
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <SourceRepoSection />

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
              onSaveKey={saveKey}
              onRemoveKey={removeKey}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

const CREDENTIAL_HINT: Record<ChatSourceRepoDto["credentialSource"], string> = {
  github_app: "Reads via the GitHub App installed on this owner.",
  none: "No GitHub App installed on this owner, the assistant cannot read this repo yet.",
};

function SourceRepoSection() {
  const client = useApi();
  const [config, setConfig] = useState<ChatSourceRepoDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.adminAi.getSourceRepo();
      setConfig(res);
      setOwner(res?.owner ?? "");
      setRepo(res?.repo ?? "");
      setRef(res?.ref ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load source repo");
    } finally {
      setLoaded(true);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await client.adminAi.setSourceRepo({
        owner: owner.trim(),
        repo: repo.trim(),
        ref: ref.trim() || null,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source repo");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await client.adminAi.clearSourceRepo();
      setConfig(null);
      setOwner("");
      setRepo("");
      setRef("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear source repo");
    } finally {
      setBusy(false);
    }
  }

  const dirty = config
    ? owner.trim() !== config.owner ||
      repo.trim() !== config.repo ||
      (ref.trim() || null) !== config.ref
    : owner.trim() !== "" || repo.trim() !== "";
  const canSave = owner.trim().length > 0 && repo.trim().length > 0 && dirty && !busy;

  return (
    <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-app-text-muted">
        Assistant source repository
      </div>
      <p className="mb-3 text-sm text-app-text-muted">
        The repository the assistant reads to answer questions about how the platform works (for
        example "how do I change the logo"). Leave it unset to disable the platform_source tools.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-app-text-muted">Owner (org or user)</span>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="rainvertex"
            className="w-48 rounded-md border border-app-border bg-app-bg-sunken px-2 py-1 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-app-text-muted">Repository</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="HiveDP"
            className="w-48 rounded-md border border-app-border bg-app-bg-sunken px-2 py-1 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-app-text-muted">Branch or ref (optional)</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="default branch"
            className="w-48 rounded-md border border-app-border bg-app-bg-sunken px-2 py-1 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
        </label>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        {config && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10 disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {loaded && (
        <div className="mt-3 text-xs">
          {config ? (
            <span
              className={
                config.credentialSource === "none" ? "text-app-warning" : "text-app-text-muted"
              }
            >
              {CREDENTIAL_HINT[config.credentialSource]}
            </span>
          ) : (
            <span className="text-app-text-muted">Not configured.</span>
          )}
        </div>
      )}
    </section>
  );
}

function ProviderCard({
  provider,
  busy,
  onToggle,
  onSaveKey,
  onRemoveKey,
}: {
  provider: AdminAiProviderGroup;
  busy: string | null;
  onToggle: (m: AdminAiModelRow) => void;
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
