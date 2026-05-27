import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useCurrentUser } from "./auth";
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemeAuditPage } from "./pages/ThemeAudit";
import { AdminUsersPage } from "./admin/AdminUsersPage";
import { AuditPage } from "./admin/AuditPage";
import { JobsPage } from "./admin/JobsPage";
import { McpTokensPage } from "./admin/McpTokensPage";
import { SecretsPage } from "./admin/SecretsPage";
import {
  AgentApprovalsPage,
  AgentDetailPage,
  AgentNewWizard,
  AgentsPage,
} from "@feature/agents-frontend";
import { ChatRoute } from "./widgets/chat/ChatRoute";
import {
  CatalogEntityPage,
  CatalogPage,
  EntityApisTab,
  EntityAuditTab,
  EntityDocsTab,
  EntityOverviewTab,
  EntityRelatedTab,
  EntityRunsTab,
  EntityScorecardsTab,
} from "@feature/catalog-frontend";
import { ScorecardEditPage, ScorecardsPage } from "@feature/scorecards-frontend";
import { DoraMetricsPage } from "@feature/dora-metrics-frontend";
import { IntegrationManagePage, IntegrationsPage } from "@feature/integrations-frontend";
import { ObservabilityConfigPage, ObservabilityPage } from "@feature/observability-frontend";
import {
  ScaffolderBindingsPage,
  ScaffolderPage,
  ScaffolderPlanPage,
  ScaffolderTaskPage,
  ScaffolderTemplatePage,
} from "@feature/scaffolder-frontend";
import { SearchPage } from "@feature/search-frontend";
import {
  AdminTeamPoliciesPage,
  AdminTeamRequestsPage,
  RequestMaintainerPickerPage,
  RequestTeamPage,
  TeamDetailPage,
  TeamsPage,
} from "@feature/teams-frontend";
import { MyApprovalsTeamPage, MyRequestsTeamPage } from "@feature/requests-frontend";
import { NotificationsPage } from "@feature/notifications-frontend";
import { WebhookSettingsPage } from "@feature/webhooks-frontend";

function AdminRoute({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  if (me.role !== "admin") {
    return (
      <div className="p-8">
        <h1 className="mb-2 text-xl font-semibold text-app-text">Forbidden</h1>
        <p className="text-sm text-app-text-muted">
          You need the <strong>admin</strong> role to view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/chat/:conversationId?" element={<ChatRoute />} />
      <Route path="/p/:pageId" element={<DashboardPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/agents/new" element={<AgentNewWizard />} />
      <Route path="/agents/approvals" element={<AgentApprovalsPage />} />
      <Route path="/agents/:userId" element={<AgentDetailPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/catalog/:id" element={<CatalogEntityPage />}>
        <Route index element={<EntityOverviewTab />} />
        <Route path="related" element={<EntityRelatedTab />} />
        <Route path="scorecards" element={<EntityScorecardsTab />} />
        <Route path="docs" element={<EntityDocsTab />} />
        <Route path="apis" element={<EntityApisTab />} />
        <Route path="runs" element={<EntityRunsTab />} />
        <Route path="audit" element={<EntityAuditTab />} />
      </Route>
      <Route path="/scorecards" element={<ScorecardsPage />} />
      <Route path="/scorecards/:id" element={<ScorecardEditPage />} />
      <Route path="/dora-metrics" element={<DoraMetricsPage />} />
      <Route
        path="/integrations"
        element={
          <AdminRoute>
            <IntegrationsPage />
          </AdminRoute>
        }
      />
      <Route
        path="/integrations/:id"
        element={
          <AdminRoute>
            <IntegrationManagePage />
          </AdminRoute>
        }
      />
      <Route path="/observability" element={<ObservabilityPage />} />
      <Route path="/observability/config" element={<ObservabilityConfigPage />} />
      <Route path="/scaffolder" element={<ScaffolderPage />} />
      <Route path="/scaffolder/bindings" element={<ScaffolderBindingsPage />} />
      <Route path="/scaffolder/plans/:planId" element={<ScaffolderPlanPage />} />
      <Route path="/scaffolder/tasks/:taskId" element={<ScaffolderTaskPage />} />
      <Route path="/scaffolder/:templateId" element={<ScaffolderTemplatePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/teams/requests" element={<Navigate to="/requests/team" replace />} />
      <Route path="/teams/maintainer-requests" element={<Navigate to="/requests/team" replace />} />
      <Route
        path="/teams/maintainer-approvals"
        element={<Navigate to="/approvals/team" replace />}
      />
      <Route path="/teams/:slug" element={<TeamDetailPage />} />
      <Route path="/requests/team" element={<MyRequestsTeamPage />} />
      <Route path="/approvals/team" element={<MyApprovalsTeamPage />} />
      <Route path="/self-service/request-team" element={<RequestTeamPage />} />
      <Route path="/self-service/request-maintainer" element={<RequestMaintainerPickerPage />} />
      <Route path="/teams/:slug/webhooks" element={<WebhookSettingsPage scope="team" />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/settings/webhooks" element={<WebhookSettingsPage scope="user" />} />
      <Route path="/admin/team-requests" element={<AdminTeamRequestsPage />} />
      <Route path="/admin/team-policies" element={<AdminTeamPoliciesPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/secrets" element={<SecretsPage />} />
      <Route path="/admin/audit" element={<AuditPage />} />
      <Route path="/admin/jobs" element={<JobsPage />} />
      <Route path="/admin/mcp-tokens" element={<McpTokensPage />} />
      {import.meta.env.DEV && <Route path="/theme-audit" element={<ThemeAuditPage />} />}
    </Routes>
  );
}
