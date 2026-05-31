// Settings page for managing user-scoped and team-scoped outbound webhooks.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { WebhookSubscriptionDto } from "@internal/shared-types";

const KNOWN_EVENT_KINDS = [
  "team.member.added",
  "team.member.removed",
  "team.request.submitted",
  "team.request.approved",
  "team.request.rejected",
  "team.request.changes_proposed",
  "team.request.counter_proposed",
  "team.request.auto_cancelled",
  "team.request.expired",
  "team.request.cancelled",
  "webhook.ping",
];

interface WebhookSettingsPageProps {
  scope?: "user" | "team";
}

export function WebhookSettingsPage({ scope = "user" }: WebhookSettingsPageProps) {
  const params = useParams<{ slug?: string }>();
  const teamSlug = scope === "team" ? params.slug : undefined;
  const api = useApi();
  const [items, setItems] = useState<WebhookSubscriptionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState<{ id: string; secret: string } | null>(null);

  const [url, setUrl] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await api.webhooks.list({ teamSlug });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [api, teamSlug]);

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
      const created = await api.webhooks.create({ url, eventKinds: selectedKinds, teamSlug });
      if (created.secret) setShowSecret({ id: created.id, secret: created.secret });
      setUrl("");
      setSelectedKinds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this webhook subscription?")) return;
    setBusy(true);
    try {
      await api.webhooks.delete(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(id: string) {
    setBusy(true);
    try {
      await api.webhooks.test(id);
      alert("Ping enqueued — check delivery history shortly.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title={teamSlug ? `Team webhooks · ${teamSlug}` : "My webhooks"}
      description={
        teamSlug
          ? "Outbound webhooks for this team's events."
          : "Outbound webhooks for events that target you."
      }
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}

      <p className="mb-3 text-xs text-app-text-muted">
        Each delivery is signed using <code>X-MEP-Signature: sha256=&lt;hex&gt;</code> over the raw
        body, using the subscription secret. Slack-format payload (<code>text</code>,{" "}
        <code>blocks</code>) is sent automatically when the URL is <code>hooks.slack.com</code>;
        native JSON otherwise.
      </p>

      {showSecret && (
        <div className="mb-4 rounded-md border border-app-success bg-app-surface p-3 text-sm">
          <div className="font-semibold text-app-text">Webhook created. Save this secret now:</div>
          <code className="mt-1 block break-all text-xs text-app-text">{showSecret.secret}</code>
          <button
            type="button"
            onClick={() => setShowSecret(null)}
            className="mt-2 text-xs text-app-text-muted hover:text-app-text"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-app-text">New subscription</h2>
        <label className="block text-sm">
          <span className="text-xs text-app-text-muted">URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            disabled={busy}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1"
          />
        </label>
        <fieldset className="mt-3">
          <legend className="text-xs text-app-text-muted">Event kinds</legend>
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
          className="mt-3 rounded-md bg-app-primary px-3 py-1 text-sm text-app-primary-on disabled:opacity-50"
        >
          Create
        </button>
      </section>

      <h2 className="mb-2 text-sm font-semibold text-app-text">Existing subscriptions</h2>
      {!items && <p className="text-sm text-app-text-muted">Loading…</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">No webhooks yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-app-border rounded-lg border border-app-border bg-app-surface">
          {items.map((s) => (
            <li key={s.id} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-app-text">{s.url}</div>
                  <div className="text-xs text-app-text-muted">{s.eventKinds.join(", ")}</div>
                  {!s.active && <div className="text-xs text-app-text-muted">disabled</div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTest(s.id)}
                    disabled={busy}
                    className="rounded-md border border-app-border px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover"
                  >
                    Send ping
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(s.id)}
                    disabled={busy}
                    className="rounded-md border border-app-border px-2 py-1 text-xs text-app-text-muted hover:text-app-danger"
                  >
                    Delete
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
