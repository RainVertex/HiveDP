import type { PageSection } from "@internal/shared-types";

export type SidebarSection = PageSection | "home" | "account" | "integrations" | "chat";

/** Map a URL pathname to its rail section. */
export function sectionFromPath(pathname: string): SidebarSection {
  // Normalize trailing slash so `/catalog/` matches `/catalog`.
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "home";
  if (path.startsWith("/chat")) return "chat";
  // Dashboard pages live under /p/:id and don't have a section in their URL.
  // SidebarContext intercepts this — it falls back to the user's last tree
  // section, and DashboardPage overrides it with the page's actual section
  // once loaded.
  if (path.startsWith("/p/")) return "home";
  if (path.startsWith("/catalog") || path.startsWith("/scorecards")) return "catalog";
  if (path.startsWith("/scaffolder") || path.startsWith("/self-service")) return "selfservice";
  if (path.startsWith("/requests") || path.startsWith("/approvals")) return "requests";
  if (path.startsWith("/agents")) return "agents";
  if (path.startsWith("/search")) return "catalog";
  if (path.startsWith("/teams")) return "teams";
  if (path.startsWith("/observability") || path.startsWith("/dora-metrics")) return "observability";
  if (path.startsWith("/vikunja") || path.startsWith("/workspace")) return "workspace";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/integrations")) return "integrations";
  if (path.startsWith("/settings") || path.startsWith("/notifications")) return "account";
  // Placeholder pages render under whatever section they were created in;
  // there's no way to tell from the URL alone, so they fall through to home.
  return "home";
}

export function sectionHasTree(section: SidebarSection): section is PageSection {
  return (
    section !== "home" && section !== "account" && section !== "integrations" && section !== "chat"
  );
}
