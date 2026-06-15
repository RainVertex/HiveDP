import type { ComponentProps, ComponentType, ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { AgentsPage } from "./AgentsPage";
import { AgentFormPage } from "./AgentFormPage";
import { AgentDetailPage } from "./AgentDetailPage";
import { AgentRunPage } from "./AgentRunPage";
import { SkillsListPage } from "./SkillsListPage";
import { SkillFormPage } from "./SkillFormPage";

// avatarPresets is shell-provided (a build-time virtual module), injected by the app shell.
// AdminRoute is the shell's role guard, so only admins reach the create and edit forms.
export function featureRoutes(ctx: {
  avatarPresets: ComponentProps<typeof AgentFormPage>["avatarPresets"];
  AdminRoute: ComponentType<{ children: ReactNode }>;
}): RouteObject[] {
  const { AdminRoute } = ctx;
  return [
    { path: "/agents", element: <AgentsPage /> },
    {
      path: "/agents/new",
      element: (
        <AdminRoute>
          <AgentFormPage avatarPresets={ctx.avatarPresets} />
        </AdminRoute>
      ),
    },
    { path: "/agents/:id", element: <AgentDetailPage /> },
    {
      path: "/agents/:id/edit",
      element: (
        <AdminRoute>
          <AgentFormPage avatarPresets={ctx.avatarPresets} />
        </AdminRoute>
      ),
    },
    { path: "/agents/:id/runs/:runId", element: <AgentRunPage /> },
    { path: "/skills", element: <SkillsListPage /> },
    {
      path: "/skills/new",
      element: (
        <AdminRoute>
          <SkillFormPage />
        </AdminRoute>
      ),
    },
    {
      path: "/skills/:id/edit",
      element: (
        <AdminRoute>
          <SkillFormPage />
        </AdminRoute>
      ),
    },
  ];
}
