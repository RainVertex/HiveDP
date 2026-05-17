import { Routes, Route, Navigate } from "react-router-dom";
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
  CatalogDriftInboxPage,
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
import { IntegrationsPage } from "@feature/integrations-frontend";
import { ObservabilityPage } from "@feature/observability-frontend";
import {
  ScaffolderBindingsPage,
  ScaffolderDriftInboxPage,
  ScaffolderPage,
  ScaffolderPlanPage,
  ScaffolderTaskPage,
  ScaffolderTemplatePage,
} from "@feature/scaffolder-frontend";
import { SearchPage } from "@feature/search-frontend";
import {
  AdminTeamPoliciesPage,
  AdminTeamRequestsPage,
  GithubDriftDashboard,
  RequestMaintainerPickerPage,
  RequestTeamPage,
  TeamDetailPage,
  TeamsPage,
} from "@feature/teams-frontend";
import { MyApprovalsTeamPage, MyRequestsTeamPage } from "@feature/requests-frontend";
import { NotificationsPage } from "@feature/notifications-frontend";
import { WebhookSettingsPage } from "@feature/webhooks-frontend";
import {
  IntegrationDetailPage,
  ProjectDetailPage,
  ProjectsListPage,
  WorkItemDetailPage,
  WorkspacePage,
} from "@feature/workspace-frontend";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/chat" element={<ChatRoute />} />
      <Route path="/chat/:conversationId" element={<ChatRoute />} />
      <Route path="/p/:pageId" element={<DashboardPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/agents/new" element={<AgentNewWizard />} />
      <Route path="/agents/approvals" element={<AgentApprovalsPage />} />
      <Route path="/agents/:userId" element={<AgentDetailPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/catalog/drift" element={<CatalogDriftInboxPage />} />
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
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/observability" element={<ObservabilityPage />} />
      <Route path="/scaffolder" element={<ScaffolderPage />} />
      <Route path="/scaffolder/bindings" element={<ScaffolderBindingsPage />} />
      <Route path="/scaffolder/drift" element={<ScaffolderDriftInboxPage />} />
      <Route path="/scaffolder/plans/:planId" element={<ScaffolderPlanPage />} />
      <Route path="/scaffolder/tasks/:taskId" element={<ScaffolderTaskPage />} />
      <Route path="/scaffolder/:templateId" element={<ScaffolderTemplatePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/teams" element={<TeamsPage />} />
      {/* Round-1 paths redirect into the new Requests section. Bookmarks and
       *  notification deep-links sent before the cutover keep working. */}
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
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="/workspace/projects" element={<ProjectsListPage />} />
      <Route path="/workspace/projects/:id" element={<ProjectDetailPage />} />
      <Route path="/workspace/work-items/:id" element={<WorkItemDetailPage />} />
      <Route path="/workspace/integrations/:id" element={<IntegrationDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/secrets" element={<SecretsPage />} />
      <Route path="/admin/audit" element={<AuditPage />} />
      <Route path="/admin/jobs" element={<JobsPage />} />
      <Route path="/admin/mcp-tokens" element={<McpTokensPage />} />
      <Route
        path="/admin/integrations/github/:integrationId/drift"
        element={<GithubDriftDashboard />}
      />
      {import.meta.env.DEV && <Route path="/theme-audit" element={<ThemeAuditPage />} />}
    </Routes>
  );
}
