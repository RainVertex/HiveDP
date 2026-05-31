// Catalog of integration providers; entries without a ConnectDialog render as "Coming soon" cards.

import type { ComponentType } from "react";
import type { IntegrationDetail, IntegrationKind } from "@internal/shared-types";
import { GithubConnectDialog } from "./GithubConnectDialog";
import { GithubManagePanel } from "./GithubManagePanel";
import { GrafanaConnectDialog } from "./GrafanaConnectDialog";
import { GrafanaManagePanel } from "./GrafanaManagePanel";

export interface ProviderDialogProps {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export interface ManagePanelProps {
  integration: IntegrationDetail;
  onChanged: () => void;
}

export interface ProviderEntry {
  kind: IntegrationKind;
  label: string;
  description: string;
  ConnectDialog?: ComponentType<ProviderDialogProps>;
  ManagePanel?: ComponentType<ManagePanelProps>;
}

export const PROVIDERS: ProviderEntry[] = [
  {
    kind: "github",
    label: "GitHub (App Installation)",
    description:
      "Install the GitHub App on an organization. Imports repos, teams, and members, kept in sync via webhooks and weekly reconciliation.",
    ConnectDialog: GithubConnectDialog,
    ManagePanel: GithubManagePanel,
  },
  {
    kind: "jira",
    label: "Jira",
    description: "Atlassian projects, issues, and sprints.",
  },
  {
    kind: "slack",
    label: "Slack",
    description: "Channel events, mentions, and notifications.",
  },
  {
    kind: "grafana",
    label: "Grafana",
    description:
      "Service-account-token connection to a Grafana instance. Proxies queries to Prometheus, Loki, and Tempo and routes Alertmanager webhooks into the notifications bell.",
    ConnectDialog: GrafanaConnectDialog,
    ManagePanel: GrafanaManagePanel,
  },
];

export function findProvider(kind: IntegrationKind): ProviderEntry | undefined {
  return PROVIDERS.find((p) => p.kind === kind);
}
