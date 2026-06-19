// The one place that lists which features the shell mounts. Adding a feature means adding it here once.
// Each feature's mount paths, order, and auth phase live in its own featureManifest, not in this file.
import type { FeatureManifestSource } from "@internal/feature-host";
import { featureManifest as agentsManifest } from "@feature/agents-backend";
import { featureManifest as agentToolsManifest } from "@feature/agent-tools-backend";
import { featureManifest as catalogManifest } from "@feature/catalog-backend";
import { featureManifest as chatManifest } from "@feature/chat-backend";
import { featureManifest as doraMetricsManifest } from "@feature/dora-metrics-backend";
import { featureManifest as integrationsManifest } from "@feature/integrations-backend";
import { featureManifest as notificationsManifest } from "@feature/notifications-backend";
import { featureManifest as observabilityManifest } from "@feature/observability-backend";
import { featureManifest as onboardingManifest } from "@feature/onboarding-backend";
import { featureManifest as pagesManifest } from "@feature/pages-backend";
import { featureManifest as projectsManifest } from "@feature/projects-backend";
import { featureManifest as scaffolderManifest } from "@feature/scaffolder-backend";
import { featureManifest as searchManifest } from "@feature/search-backend";
import { featureManifest as teamsManifest } from "@feature/teams-backend";
import { featureManifest as webhooksManifest } from "@feature/webhooks-backend";

export const featureRegistry: FeatureManifestSource[] = [
  agentsManifest,
  agentToolsManifest,
  catalogManifest,
  chatManifest,
  doraMetricsManifest,
  integrationsManifest,
  notificationsManifest,
  observabilityManifest,
  onboardingManifest,
  pagesManifest,
  projectsManifest,
  scaffolderManifest,
  searchManifest,
  teamsManifest,
  webhooksManifest,
];
