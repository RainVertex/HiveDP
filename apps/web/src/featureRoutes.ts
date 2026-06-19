// The one place that lists which feature frontends contribute routes. Adding a feature means adding it
// here once; the actual paths live in each feature's own featureRoutes export, not in this file.
import type { ComponentType, ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { featureRoutes as agentsRoutes } from "@feature/agents-frontend";
import { featureRoutes as catalogRoutes } from "@feature/catalog-frontend";
import { featureRoutes as scorecardsRoutes } from "@feature/scorecards-frontend";
import { featureRoutes as doraMetricsRoutes } from "@feature/dora-metrics-frontend";
import { featureRoutes as integrationsRoutes } from "@feature/integrations-frontend";
import { featureRoutes as observabilityRoutes } from "@feature/observability-frontend";
import { featureRoutes as scaffolderRoutes } from "@feature/scaffolder-frontend";
import { featureRoutes as searchRoutes } from "@feature/search-frontend";
import { featureRoutes as teamsRoutes } from "@feature/teams-frontend";
import { featureRoutes as notificationsRoutes } from "@feature/notifications-frontend";
import { featureRoutes as projectsRoutes } from "@feature/projects-frontend";
import { featureRoutes as webhooksRoutes } from "@feature/webhooks-frontend";

// Shell-only values that some feature routes need (resolved in apps/web and passed in as data).
export interface FeatureRoutesContext {
  avatarPresets: Parameters<typeof agentsRoutes>[0]["avatarPresets"];
  AdminRoute: ComponentType<{ children: ReactNode }>;
}

export function buildFeatureRoutes(ctx: FeatureRoutesContext): RouteObject[] {
  return [
    ...agentsRoutes({ avatarPresets: ctx.avatarPresets, AdminRoute: ctx.AdminRoute }),
    ...catalogRoutes,
    ...scorecardsRoutes,
    ...doraMetricsRoutes,
    ...integrationsRoutes({ AdminRoute: ctx.AdminRoute }),
    ...observabilityRoutes,
    ...scaffolderRoutes,
    ...searchRoutes,
    ...teamsRoutes,
    ...notificationsRoutes,
    ...projectsRoutes,
    ...webhooksRoutes,
  ];
}
