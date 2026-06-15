import { registerTools, registerToolGroups, type RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "./types";
import { coreGroup } from "./groups/core";
import { teamsGroup } from "./groups/teams";
import { requestsGroup } from "./groups/requests";
import { catalogGroup } from "./groups/catalog";
import { orgGroup } from "./groups/org";
import { notificationsGroup } from "./groups/notifications";
import { integrationsGroup } from "./groups/integrations";
import { catalogEnrichGroup } from "./groups/catalog-enrich";
import { platformSourceGroup } from "./groups/platform-source";

// Every tool group. Groups only organize tools for the catalog shown in the skill editor; they are
// not skills. Skills are admin-managed rows (see features/agents) that reference tool ids directly.
const ALL_GROUPS: ToolGroup[] = [
  coreGroup,
  teamsGroup,
  requestsGroup,
  catalogGroup,
  orgGroup,
  notificationsGroup,
  integrationsGroup,
  platformSourceGroup,
  catalogEnrichGroup,
];

// Stamp each tool with its group id.
function tagged(group: ToolGroup): RegisteredTool[] {
  return group.tools.map((t) => ({ ...t, group: group.meta.id }));
}

export function registerAllTools(): void {
  // Register every skill's meta so its id is always recognized, but only enabled skills' tools.
  registerToolGroups(ALL_GROUPS.map((g) => g.meta));
  registerTools(ALL_GROUPS.filter((g) => g.enabled?.() !== false).flatMap(tagged));
}
