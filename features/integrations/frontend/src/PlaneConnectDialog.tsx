// Plane connect-flow dialog. Collects baseUrl, API token, workspace slug,
// then displays the webhook URL + the next steps to set up webhooks.
//
// The webhook secret flow is two-sided: Plane generates the secret on its
// side (shown once on the Plane create-webhook page) and the admin pastes
// it back into our integration detail page. We never generate or own that
// secret.

import { useState } from "react";
import { useApi } from "@internal/api-client/react";

export interface PlaneConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export function PlaneConnectDialog({ open, onClose, onConnected }: PlaneConnectDialogProps) {
  const api = useApi();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    integrationId: string;
    webhookUrl: string;
    syncError: string | null;
  } | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.integrations.connectPlane({
        name: name.trim() || `Plane (${workspaceSlug})`,
        baseUrl: baseUrl.trim(),
        oauthClientId: oauthClientId.trim(),
        oauthClientSecret: oauthClientSecret.trim(),
        workspaceSlug: workspaceSlug.trim(),
      });
      // The integrations.connectPlane response shape includes webhook info on
      // success — surfaced directly from the backend.
      const r = res as unknown as {
        integration: { id: string };
        webhookUrl: string;
        syncError: string | null;
      };
      setResult({
        integrationId: r.integration.id,
        webhookUrl: r.webhookUrl,
        syncError: r.syncError,
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-app-border bg-app-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <h3 className="text-sm font-semibold text-app-text">Connect a Plane workspace</h3>
            <p className="text-xs text-app-text-muted">
              Self-hosted Plane (https://plane.so). Create an OAuth app in Plane workspace settings
              and enter the credentials below.
            </p>
            <Field
              label="Display name"
              value={name}
              onChange={setName}
              placeholder="Plane (engineering)"
            />
            <Field
              label="Base URL"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://plane.example.com"
            />
            <Field
              label="OAuth Client ID"
              value={oauthClientId}
              onChange={setOauthClientId}
              placeholder="plane_oauth_..."
            />
            <Field
              label="OAuth Client Secret"
              value={oauthClientSecret}
              onChange={setOauthClientSecret}
              placeholder="plane_secret_..."
              type="password"
            />
            <Field
              label="Workspace slug"
              value={workspaceSlug}
              onChange={setWorkspaceSlug}
              placeholder="engineering"
            />
            {error && <p className="text-xs text-app-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-app-text">Connected</h3>
            {result.syncError && (
              <p className="rounded border border-app-danger bg-app-surface p-2 text-xs text-app-danger">
                Initial sync failed: {result.syncError}. Open the integration page and use
                &quot;Sync now&quot; to retry.
              </p>
            )}
            <p className="text-xs text-app-text-muted">
              To finish setup, create a webhook in Plane and paste the secret it generates back into
              the integration page:
            </p>
            <ol className="space-y-2 text-xs text-app-text-muted">
              <li>
                <span className="font-medium text-app-text">1.</span> In Plane → Workspace Settings
                → Webhooks, click <em>Add webhook</em>. Use this Payload URL (prefix with your
                tunnel host — e.g. an ngrok URL — since Plane blocks private addresses):
                <code className="mt-1 block break-all rounded bg-app-bg p-2 text-app-text">
                  {result.webhookUrl}
                </code>
              </li>
              <li>
                <span className="font-medium text-app-text">2.</span> Plane shows you a secret like{" "}
                <code>plane_wh_…</code> exactly once. Copy it.
              </li>
              <li>
                <span className="font-medium text-app-text">3.</span> Paste it on the integration
                detail page (we&apos;ll open it for you).
              </li>
            </ol>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
              >
                Close
              </button>
              <a
                href={`/workspace/integrations/${result.integrationId}`}
                onClick={onClose}
                className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on"
              >
                Open integration page
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 text-sm text-app-text"
      />
    </label>
  );
}
