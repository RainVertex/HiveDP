// Two-stage Grafana connect dialog: probe for datasources, then commit and show the one-time webhook secret.

import { useState } from "react";
import { useApi } from "@internal/api-client/react";
import { DatasourceSelect, pickDefaultUid, type DatasourceCandidate } from "./DatasourceSelect";

export interface GrafanaConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

interface ProbeResult {
  datasources: {
    prometheus: DatasourceCandidate[];
    loki: DatasourceCandidate[];
    tempo: DatasourceCandidate[];
  };
  imageRendererAvailable: boolean;
}

interface ConnectResult {
  integrationId: string;
  webhookUrl: string;
  webhookSecret: string;
  imageRendererAvailable: boolean;
  dsUid: { prometheus: string; loki?: string; tempo?: string };
}

export function GrafanaConnectDialog({ open, onClose, onConnected }: GrafanaConnectDialogProps) {
  const api = useApi();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [suppressionMinutes, setSuppressionMinutes] = useState<string>("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [promUid, setPromUid] = useState("");
  const [lokiUid, setLokiUid] = useState("");
  const [tempoUid, setTempoUid] = useState("");

  const [result, setResult] = useState<ConnectResult | null>(null);

  if (!open) return null;

  async function handleProbe(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.integrations.probeGrafana({
        baseUrl: baseUrl.trim(),
        apiToken: apiToken.trim(),
      });
      setProbe(res);
      setPromUid(pickDefaultUid(res.datasources.prometheus));
      setLokiUid(pickDefaultUid(res.datasources.loki));
      setTempoUid(pickDefaultUid(res.datasources.tempo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true);
    setError(null);
    try {
      const minutes = Number(suppressionMinutes);
      const suppressionMs =
        Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes * 60_000) : undefined;
      const res = await api.integrations.connectGrafana({
        name: name.trim() || `Grafana (${new URL(baseUrl.trim()).host})`,
        baseUrl: baseUrl.trim(),
        apiToken: apiToken.trim(),
        dsUid: {
          prometheus: promUid,
          ...(lokiUid ? { loki: lokiUid } : {}),
          ...(tempoUid ? { tempo: tempoUid } : {}),
        },
        ...(suppressionMs !== undefined ? { alertRefireSuppressionMs: suppressionMs } : {}),
      });
      setResult({
        integrationId: res.integration.id,
        webhookUrl: res.webhookUrl,
        webhookSecret: res.webhookSecret,
        imageRendererAvailable: res.imageRendererAvailable,
        dsUid: res.dsUid,
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
        {!probe && !result && (
          <form onSubmit={handleProbe} className="space-y-3">
            <h3 className="text-sm font-semibold text-app-text">Connect Grafana</h3>
            <p className="text-xs text-app-text-muted">
              The platform talks to Prometheus, Loki, and Tempo through Grafana&apos;s datasource
              proxy. One service-account token is all that&apos;s needed.
            </p>
            <Field
              label="Display name"
              value={name}
              onChange={setName}
              placeholder="Grafana (prod)"
            />
            <Field
              label="Base URL"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://grafana.example.com"
            />
            <Field
              label="Service account token"
              value={apiToken}
              onChange={setApiToken}
              placeholder="glsa_…"
              type="password"
            />
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-xs text-app-text-muted underline-offset-2 hover:underline"
            >
              {advancedOpen ? "Hide advanced" : "Advanced…"}
            </button>
            {advancedOpen && (
              <Field
                label="Re-notify suppression window (minutes)"
                value={suppressionMinutes}
                onChange={setSuppressionMinutes}
                placeholder="60"
              />
            )}
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
                disabled={busy || !baseUrl.trim() || !apiToken.trim()}
                className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
              >
                {busy ? "Probing…" : "Connect"}
              </button>
            </div>
          </form>
        )}

        {probe && !result && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-app-text">Pick datasources</h3>
            <p className="text-xs text-app-text-muted">
              Grafana exposes more than one matching datasource for some types. Confirm which one
              the platform should query.
            </p>
            <DatasourceSelect
              label="Prometheus (required for the scrape job)"
              value={promUid}
              onChange={setPromUid}
              candidates={probe.datasources.prometheus}
              required
            />
            <DatasourceSelect
              label="Loki (optional; enables the logs panel)"
              value={lokiUid}
              onChange={setLokiUid}
              candidates={probe.datasources.loki}
            />
            <DatasourceSelect
              label="Tempo (optional; enables trace drill-down)"
              value={tempoUid}
              onChange={setTempoUid}
              candidates={probe.datasources.tempo}
            />
            {!probe.imageRendererAvailable && (
              <p className="rounded border border-app-border bg-app-bg p-2 text-xs text-app-text-muted">
                Dashboard embeds disabled — install the <code>grafana-image-renderer</code> plugin
                on this Grafana to enable PNG panel embeds.
              </p>
            )}
            {error && <p className="text-xs text-app-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProbe(null)}
                className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={busy || !promUid}
                className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save integration"}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-app-text">Connected</h3>
            <p className="text-xs text-app-text-muted">
              Set up the Alertmanager webhook in Grafana so firing alerts land in the notifications
              bell. Copy the secret <strong>now</strong> — it is shown exactly once.
            </p>
            <ol className="space-y-2 text-xs text-app-text-muted">
              <li>
                <span className="font-medium text-app-text">1.</span> In Grafana → Alerting →
                Contact points, create a <em>Webhook</em> contact point. Use this URL (prefix with
                your public tunnel host):
                <code className="mt-1 block break-all rounded bg-app-bg p-2 text-app-text">
                  {result.webhookUrl}
                </code>
              </li>
              <li>
                <span className="font-medium text-app-text">2.</span> Under{" "}
                <em>Optional Webhook settings → HTTP headers</em>, add a header:
                <code className="mt-1 block break-all rounded bg-app-bg p-2 text-app-text">
                  Authorization: Bearer {result.webhookSecret}
                </code>
              </li>
              <li>
                <span className="font-medium text-app-text">3.</span> Save the contact point and
                route alert rules to it.
              </li>
            </ol>
            {!result.imageRendererAvailable && (
              <p className="rounded border border-app-border bg-app-bg p-2 text-xs text-app-text-muted">
                Dashboard embeds are disabled until <code>grafana-image-renderer</code> is
                installed.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on"
              >
                Done
              </button>
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
