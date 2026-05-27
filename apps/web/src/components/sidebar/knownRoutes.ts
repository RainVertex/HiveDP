import type { PageSection } from "@internal/shared-types";

/** A canonical route the user can pick when creating a LINK page. */
export interface KnownRoute {
  path: string;
  label: string;
  /** The section this route most naturally belongs to. */
  section: PageSection | "account";
  /** Hidden from the suggestion list for non-admins. */
  adminOnly?: boolean;
}

export const KNOWN_ROUTES: KnownRoute[] = [
  // Catalog
  { path: "/catalog", label: "Catalog", section: "catalog" },
  { path: "/scorecards", label: "Scorecards", section: "catalog" },

  // Self-service (initiate-a-request entry points only)
  { path: "/scaffolder", label: "Templates", section: "selfservice" },
  { path: "/scaffolder/bindings", label: "Bindings", section: "selfservice" },
  { path: "/self-service/request-team", label: "Request a team", section: "selfservice" },
  {
    path: "/self-service/request-maintainer",
    label: "Request maintainership",
    section: "selfservice",
  },

  // Requests (status + approvals)
  { path: "/requests/team", label: "My Requests", section: "requests" },
  { path: "/approvals/team", label: "My Approvals", section: "requests" },

  // Agents
  { path: "/agents", label: "Agents", section: "agents" },
  { path: "/search", label: "Search", section: "catalog" },

  // Teams
  { path: "/teams", label: "All teams", section: "teams" },

  // Observability
  { path: "/observability", label: "Service health", section: "observability" },
  { path: "/dora-metrics", label: "DORA metrics", section: "observability" },

  // Admin
  { path: "/admin/users", label: "Users", section: "admin", adminOnly: true },
  { path: "/admin/audit", label: "Audit log", section: "admin", adminOnly: true },
  { path: "/admin/jobs", label: "Jobs", section: "admin", adminOnly: true },
  { path: "/admin/mcp-tokens", label: "MCP tokens", section: "admin", adminOnly: true },
  { path: "/admin/team-requests", label: "Team requests", section: "admin", adminOnly: true },
  { path: "/admin/team-policies", label: "Team policies", section: "admin", adminOnly: true },

  // Account / cross-section utilities
  { path: "/", label: "Home", section: "account" },
  { path: "/settings", label: "Settings", section: "account" },
  { path: "/notifications", label: "Notifications", section: "account" },
  { path: "/integrations", label: "Integrations", section: "account" },
  { path: "/settings/webhooks", label: "Webhook settings", section: "account" },
];

/** Filter and rank routes by what the user has typed so far. */
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
