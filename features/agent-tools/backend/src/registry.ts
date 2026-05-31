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

// Read-only groups the Platform Assistant gets by default; the agent-only groups are opt-in per agent.
const PLATFORM_ASSISTANT_READ_GROUPS: ToolGroup[] = [
  coreGroup,
  teamsGroup,
  requestsGroup,
  catalogGroup,
  orgGroup,
  notificationsGroup,
  integrationsGroup,
];

const AGENT_GROUPS: ToolGroup[] = [catalogEnrichGroup];

const ALL_GROUPS: ToolGroup[] = [...PLATFORM_ASSISTANT_READ_GROUPS, ...AGENT_GROUPS];

// Stamp each tool with its group id so listToolGroups() can bucket it for the UI.
function tagged(group: ToolGroup): RegisteredTool[] {
  return group.tools.map((t) => ({ ...t, group: group.meta.id }));
}

export function registerAllTools(): void {
  registerToolGroups(ALL_GROUPS.map((g) => g.meta));
  registerTools(ALL_GROUPS.flatMap(tagged));
}

export function platformAssistantReadToolIds(): string[] {
  return PLATFORM_ASSISTANT_READ_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
}
