// Thin Plane configure surface. The bulk of Plane management — webhook
// secret paste, project mirror config, sync status — already lives at
// /workspace/integrations/:id (IntegrationDetailPage in @feature/workspace-frontend).
// This panel surfaces the basic connection facts and links out.

import { Link } from "react-router-dom";
import type { IntegrationDetail } from "@internal/shared-types";

export interface PlaneManagePanelProps {
  integration: IntegrationDetail;
  onChanged: () => void;
}

export function PlaneManagePanel({ integration }: PlaneManagePanelProps) {
  if (integration.kind !== "plane") return null;
  const cfg = integration.config;
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-md border border-app-border bg-app-surface p-3">
        <h3 className="text-sm font-semibold text-app-text">Connection</h3>
        <Row label="Base URL" value={cfg.baseUrl} />
        <Row label="Workspace slug" value={cfg.workspaceSlug} />
        <Row label="Auth" value={cfg.hasOAuthCredentials ? "OAuth" : "not set"} />
        <Row label="Webhook secret" value={cfg.hasWebhookSecret ? "set" : "not set"} />
      </section>

      <section className="space-y-2 rounded-md border border-app-border bg-app-surface p-3">
        <h3 className="text-sm font-semibold text-app-text">Advanced</h3>
        <p className="text-xs text-app-text-muted">
          Project mirror configuration, webhook secret paste, and sync history are on the workspace
          detail page.
        </p>
        <Link
          to={`/workspace/integrations/${integration.id}`}
          className="inline-block rounded border border-app-border px-2 py-1 text-xs text-app-text hover:bg-app-surface-hover"
        >
          Open workspace settings
        </Link>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-app-text-muted">{label}</span>
      <span className="break-all text-right text-app-text">{value}</span>
    </div>
  );
}
