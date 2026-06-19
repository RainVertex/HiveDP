// Static registry of app routes plus a prefix/substring search helper.
import type { PageSection } from "@feature/pages-shared";

export interface KnownRoute {
  path: string;
  label: string;
  labelKey: string;
  section: PageSection | "account";
  adminOnly?: boolean;
}

export const KNOWN_ROUTES: KnownRoute[] = [
  { path: "/catalog", label: "Catalog", labelKey: "route.catalog", section: "catalog" },
  { path: "/scorecards", label: "Scorecards", labelKey: "route.scorecards", section: "catalog" },

  { path: "/scaffolder", label: "Templates", labelKey: "route.templates", section: "selfservice" },
  {
    path: "/scaffolder/bindings",
    label: "Bindings",
    labelKey: "route.bindings",
    section: "selfservice",
  },
  {
    path: "/scaffolder/editor",
    label: "Template editor",
    labelKey: "route.templateEditor",
    section: "selfservice",
    adminOnly: true,
  },
  { path: "/agents", label: "Agents", labelKey: "route.agents", section: "agents" },
  { path: "/search", label: "Search", labelKey: "route.search", section: "catalog" },

  { path: "/teams", label: "All teams", labelKey: "route.allTeams", section: "teams" },

  {
    path: "/observability",
    label: "Service health",
    labelKey: "route.serviceHealth",
    section: "observability",
  },
  {
    path: "/dora-metrics",
    label: "DORA metrics",
    labelKey: "route.doraMetrics",
    section: "observability",
  },

  {
    path: "/admin/users",
    label: "Users",
    labelKey: "route.users",
    section: "admin",
    adminOnly: true,
  },
  {
    path: "/admin/audit",
    label: "Audit log",
    labelKey: "route.auditLog",
    section: "admin",
    adminOnly: true,
  },
  { path: "/admin/jobs", label: "Jobs", labelKey: "route.jobs", section: "admin", adminOnly: true },
  {
    path: "/admin/mcp-tokens",
    label: "MCP tokens",
    labelKey: "route.mcpTokens",
    section: "admin",
    adminOnly: true,
  },
  { path: "/", label: "Home", labelKey: "route.home", section: "account" },
  { path: "/settings", label: "Settings", labelKey: "route.settings", section: "account" },
  {
    path: "/notifications",
    label: "Notifications",
    labelKey: "route.notifications",
    section: "account",
  },
  {
    path: "/integrations",
    label: "Integrations",
    labelKey: "route.integrations",
    section: "account",
  },
  {
    path: "/settings/webhooks",
    label: "Webhook settings",
    labelKey: "route.webhookSettings",
    section: "account",
  },
];

export function searchKnownRoutes(
  query: string,
  options: { isAdmin: boolean; limit?: number } = { isAdmin: false },
): KnownRoute[] {
  const q = query.trim().toLowerCase();
  const limit = options.limit ?? 8;
  const visible = KNOWN_ROUTES.filter((r) => options.isAdmin || !r.adminOnly);
  if (!q) return visible.slice(0, limit);

  const prefixMatches: KnownRoute[] = [];
  const substringMatches: KnownRoute[] = [];
  for (const r of visible) {
    const path = r.path.toLowerCase();
    const label = r.label.toLowerCase();
    if (path.startsWith(q) || label.startsWith(q)) prefixMatches.push(r);
    else if (path.includes(q) || label.includes(q)) substringMatches.push(r);
  }
  return [...prefixMatches, ...substringMatches].slice(0, limit);
}
