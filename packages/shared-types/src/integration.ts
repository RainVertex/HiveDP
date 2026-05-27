import type { ID, ISODateString, NamedEntity } from "./common";

export type IntegrationKind = "github" | "jira" | "slack" | "grafana" | "plane";

export interface Integration extends NamedEntity {
  kind: IntegrationKind;
  enabled: boolean;
  config: Record<string, unknown>;
}

// Per-kind "safe view" of an integration's config — only fields safe to display.
// Returned by GET /api/integrations/:id. Encrypted secrets are NEVER included;
// `hasApiToken` / `hasWebhookSecret` flags let the UI show a "set / not set"
// indicator without leaking the value.

export interface GrafanaIntegrationConfigView {
  baseUrl: string;
  dsUid: { prometheus: string; loki?: string; tempo?: string };
  imageRendererAvailable: boolean;
  alertRefireSuppressionMs: number;
  hasApiToken: boolean;
  hasWebhookSecret: boolean;
}

export interface PlaneIntegrationConfigView {
  baseUrl: string;
  workspaceSlug: string;
  hasOAuthCredentials: boolean;
  hasWebhookSecret: boolean;
}

export interface GithubIntegrationConfigView {
  accountLogin: string;
  installationId: number;
}

interface IntegrationDetailBase extends NamedEntity {
  enabled: boolean;
}

export type IntegrationDetail =
  | (IntegrationDetailBase & { kind: "grafana"; config: GrafanaIntegrationConfigView })
  | (IntegrationDetailBase & { kind: "plane"; config: PlaneIntegrationConfigView })
  | (IntegrationDetailBase & { kind: "github"; config: GithubIntegrationConfigView })
  | (IntegrationDetailBase & { kind: "jira" | "slack"; config: Record<string, never> });

/** Public summary of a connected GitHub App installation, exposed via GET */
export interface GithubInstallationSummary {
  integrationId: ID;
  name: string;
  accountLogin: string;
}

// One row of the GithubReconciliationRun audit table. Returned by both the
// /resync endpoint (the row it just produced) and the /drift endpoint
// (recent runs feed).
export interface GithubReconciliationRunDto {
  runId: string;
  installationId: number;
  source: "webhook" | "cron" | "manual";
  ok: boolean;
  skippedReason?: "user_account" | "no_org_login" | "app_not_configured";
  teamsCreated: number;
  teamsUpdated: number;
  teamsDeleted: number;
  membersAdded: number;
  membersRemoved: number;
  pendingQueued: number;
  pendingResolved: number;
  errors: Array<{ scope: string; reason: string }>;
  startedAt: string;
  finishedAt: string;
}

// Lightweight summary used by the inline drift badge on the integrations page.
// Replaces the previous verbose dashboard payload.
export interface GithubDriftSummaryDto {
  installationId: number;
  staleTeamCount: number;
  pendingMemberCount: number;
  lastReconciliationAt: ISODateString | null;
  staleTeams: Array<{ id: ID; name: string; lastSyncedAt: ISODateString | null }>;
}
