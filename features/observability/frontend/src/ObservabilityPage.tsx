// Top-level /observability page with Health, Logs, Alerts and Dashboards tabs.

import { useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { ServiceHealthPanel } from "./ServiceHealthPanel";
import { EntityLogsPanel } from "./EntityLogsPanel";
import { GrafanaAlertsPanel } from "./GrafanaAlertsPanel";
import { GrafanaDashboardEmbed } from "./GrafanaDashboardEmbed";

type Tab = "health" | "logs" | "alerts" | "dashboards";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "health", label: "Health" },
  { key: "logs", label: "Logs" },
  { key: "alerts", label: "Alerts" },
  { key: "dashboards", label: "Dashboards" },
];

export function ObservabilityPage() {
  const [tab, setTab] = useState<Tab>("health");
  const [entityId, setEntityId] = useState("");
  const [dashboardUid, setDashboardUid] = useState("");
  const [panelId, setPanelId] = useState("1");

  return (
    <PageLayout
      title="Observability"
      description="Service health, logs, Grafana alerts, and dashboard embeds."
      actions={
        <Link
          to="/observability/config"
          className="rounded border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
        >
          Configure
        </Link>
      }
    >
      <nav className="mb-4 flex gap-1 border-b border-app-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.key
                ? "border-app-primary text-app-text"
                : "border-transparent text-app-text-muted hover:text-app-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "health" && <ServiceHealthPanel limit={200} />}

      {tab === "alerts" && <GrafanaAlertsPanel limit={50} />}

      {tab === "logs" && (
        <div className="flex flex-col gap-3">
          <EntityIdField value={entityId} onChange={setEntityId} />
          {entityId.trim() ? (
            <EntityLogsPanel entityId={entityId.trim()} />
          ) : (
            <p className="text-xs text-app-text-muted">
              Enter an entity id to load its Loki stream.
            </p>
          )}
        </div>
      )}

      {tab === "dashboards" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Dashboard UID" value={dashboardUid} onChange={setDashboardUid} />
            <TextField label="Panel ID" value={panelId} onChange={setPanelId} />
          </div>
          {dashboardUid && Number(panelId) > 0 ? (
            <GrafanaDashboardEmbed
              dashboardUid={dashboardUid}
              panelId={Number(panelId)}
              title={`${dashboardUid} / panel ${panelId}`}
            />
          ) : (
            <p className="text-xs text-app-text-muted">
              Provide a dashboard UID and panel id to render. Requires the Grafana Image Renderer
              plugin.
            </p>
          )}
        </div>
      )}
    </PageLayout>
  );
}

function EntityIdField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">Entity id</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="catalog entity id"
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 text-sm text-app-text"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 text-sm text-app-text"
      />
    </label>
  );
}
