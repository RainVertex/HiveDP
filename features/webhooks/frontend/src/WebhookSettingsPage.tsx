// Settings page for managing user-scoped and team-scoped outbound webhooks.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useWebhooksApi } from "./client";
import { useTranslation } from "@internal/i18n";
import type { WebhookSubscriptionDto } from "@feature/webhooks-shared";

const KNOWN_EVENT_KINDS = ["team.member.added", "team.member.removed", "webhook.ping"];

interface WebhookSettingsPageProps {
  scope?: "user" | "team";
}

export function WebhookSettingsPage({ scope = "user" }: WebhookSettingsPageProps) {
  const { t } = useTranslation("webhooks");
  const params = useParams<{ slug?: string }>();
  const teamSlug = scope === "team" ? params.slug : undefined;
  const api = useWebhooksApi();
  const [items, setItems] = useState<WebhookSubscriptionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState<{ id: string; secret: string } | null>(null);

  const [url, setUrl] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await api.list({ teamSlug });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    }
  }, [api, teamSlug, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleKind(kind: string) {
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.create({ url, eventKinds: selectedKinds, teamSlug });
      if (created.secret) setShowSecret({ id: created.id, secret: created.secret });
      setUrl("");
      setSelectedKinds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("alerts.deleteConfirm"))) return;
    setBusy(true);
    try {
      await api.delete(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(id: string) {
    setBusy(true);
    try {
      await api.test(id);
      alert(t("alerts.pingEnqueued"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.testFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title={teamSlug ? t("page.titleTeam", { slug: teamSlug }) : t("page.titleUser")}
      description={teamSlug ? t("page.descriptionTeam") : t("page.descriptionUser")}
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}

      <p className="mb-3 text-xs text-app-text-muted">{t("page.signatureNote")}</p>

      {showSecret && (
        <div className="mb-4 rounded-md border border-app-success bg-app-surface p-3 text-sm">
          <div className="font-semibold text-app-text">{t("secret.banner")}</div>
          <code className="mt-1 block break-all text-xs text-app-text">{showSecret.secret}</code>
          <button
            type="button"
            onClick={() => setShowSecret(null)}
            className="mt-2 text-xs text-app-text-muted hover:text-app-text"
          >
            {t("secret.dismiss")}
          </button>
        </div>
      )}

      <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-app-text">{t("form.sectionTitle")}</h2>
        <label className="block text-sm">
          <span className="text-xs text-app-text-muted">{t("form.urlLabel")}</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("form.urlPlaceholder")}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1"
          />
        </label>
        <fieldset className="mt-3">
          <legend className="text-xs text-app-text-muted">{t("form.eventKindsLegend")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
            {KNOWN_EVENT_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedKinds.includes(k)}
                  onChange={() => toggleKind(k)}
                  disabled={busy}
                />
                <code>{k}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy || !url || selectedKinds.length === 0}
          className="mt-3 rounded-md bg-app-primary px-3 py-1 text-sm text-app-primary-foreground disabled:opacity-50"
        >
          {t("form.createButton")}
        </button>
      </section>

      <h2 className="mb-2 text-sm font-semibold text-app-text">{t("list.sectionTitle")}</h2>
      {!items && <p className="text-sm text-app-text-muted">{t("list.loading")}</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">{t("list.empty")}</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-app-border rounded-lg border border-app-border bg-app-surface">
          {items.map((s) => (
            <li key={s.id} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-app-text">{s.url}</div>
                  <div className="text-xs text-app-text-muted">{s.eventKinds.join(", ")}</div>
                  {!s.active && (
                    <div className="text-xs text-app-text-muted">{t("list.disabledLabel")}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTest(s.id)}
                    disabled={busy}
                    className="rounded-md border border-app-border px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover"
                  >
                    {t("list.sendPing")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(s.id)}
                    disabled={busy}
                    className="rounded-md border border-app-border px-2 py-1 text-xs text-app-text-muted hover:text-app-danger"
                  >
                    {t("list.delete")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}
