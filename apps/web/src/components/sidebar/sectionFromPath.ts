import type { PageSection } from "@internal/shared-types";

export type SidebarSection = PageSection | "home" | "account" | "integrations" | "chat" | "skills";

// Maps a URL pathname to its rail section.
export function sectionFromPath(pathname: string): SidebarSection {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "home";
  if (path.startsWith("/chat")) return "chat";
  // /p/:id has no section in the URL; SidebarContext and DashboardPage override this fallback.
  if (path.startsWith("/p/")) return "home";
  if (path.startsWith("/catalog") || path.startsWith("/scorecards")) return "catalog";
  if (path.startsWith("/scaffolder") || path.startsWith("/self-service")) return "selfservice";
  if (path.startsWith("/requests") || path.startsWith("/approvals")) return "requests";
  if (path.startsWith("/skills")) return "skills";
  if (path.startsWith("/agents")) return "agents";
  if (path.startsWith("/search")) return "catalog";
  if (path.startsWith("/teams")) return "teams";
  if (path.startsWith("/observability") || path.startsWith("/dora-metrics")) return "observability";
  if (path.startsWith("/projects") || path.startsWith("/tasks") || path.startsWith("/workspace"))
    return "workspace";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/integrations")) return "integrations";
  if (path.startsWith("/settings") || path.startsWith("/notifications")) return "account";
  // Placeholder pages cannot be told apart from the URL alone, so they fall through to home.
  return "home";
}

export function sectionHasTree(section: SidebarSection): section is PageSection {
  return (
    section !== "home" &&
    section !== "account" &&
    section !== "integrations" &&
    section !== "chat" &&
    section !== "skills"
  );
}
