// DTO types for third-party integrations (config views, GitHub installation reconciliation, drift).
import type { ID, ISODateString, NamedEntity } from "./common";

export type IntegrationKind = "github" | "jira" | "slack" | "grafana";

export interface Integration extends NamedEntity {
  kind: IntegrationKind;
  enabled: boolean;
  config: Record<string, unknown>;
}

// Safe view of an integration's config; encrypted secrets are NEVER included, only has* presence flags.
export interface GrafanaIntegrationConfigView {
  baseUrl: string;
  dsUid: { prometheus: string; loki?: string; tempo?: string };
  imageRendererAvailable: boolean;
  alertRefireSuppressionMs: number;
  hasApiToken: boolean;
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
  | (IntegrationDetailBase & { kind: "github"; config: GithubIntegrationConfigView })
  | (IntegrationDetailBase & { kind: "jira" | "slack"; config: Record<string, never> });

export interface GithubInstallationSummary {
  integrationId: ID;
  name: string;
  accountLogin: string;
}

// One row of the GithubReconciliationRun audit table.
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

export interface GithubDriftSummaryDto {
  installationId: number;
  staleTeamCount: number;
  pendingMemberCount: number;
  lastReconciliationAt: ISODateString | null;
  staleTeams: Array<{ id: ID; name: string; lastSyncedAt: ISODateString | null }>;
}
