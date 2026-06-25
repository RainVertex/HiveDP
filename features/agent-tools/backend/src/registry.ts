import {
  registerTools,
  registerToolGroups,
  listRegisteredToolIds,
  type RegisteredTool,
} from "@internal/llm-core";
import { prisma } from "@internal/db";
import type { ToolGroup } from "./types";
import { coreGroup } from "./groups/core";
import { teamsGroup } from "./groups/teams";
import { catalogGroup } from "./groups/catalog";
import { orgGroup } from "./groups/org";
import { notificationsGroup } from "./groups/notifications";
import { integrationsGroup } from "./groups/integrations";
import { repoGroup } from "./groups/repo";
import { projectsGroup } from "./groups/projects";
import { scaffolderGroup } from "./groups/scaffolder";

// Every tool group. Groups only organize tools for the catalog shown in the skill editor; they are
// not skills. Skills are admin-managed rows (see features/agents) that reference tool ids directly.
const ALL_GROUPS: ToolGroup[] = [
  coreGroup,
  teamsGroup,
  catalogGroup,
  orgGroup,
  projectsGroup,
  repoGroup,
  scaffolderGroup,
  notificationsGroup,
  integrationsGroup,
];

// Stamp each tool with its group id.
function tagged(group: ToolGroup): RegisteredTool[] {
  return group.tools.map((t) => ({ ...t, group: group.meta.id }));
}

export function registerAllTools(): void {
  registerToolGroups(ALL_GROUPS.map((g) => g.meta));
  registerTools(ALL_GROUPS.flatMap(tagged));
}

// Warn (never throw) when a built-in skill references a tool id that is not registered, so a typo or
// stale id in the seed surfaces at boot instead of silently dropping the tool at run time.
export async function validateBuiltinSkillToolIds(): Promise<void> {
  const known = new Set(listRegisteredToolIds());
  const skills = await prisma.skill.findMany({
    where: { builtin: true },
    select: { id: true, toolIds: true },
  });
  for (const s of skills) {
    const ids = Array.isArray(s.toolIds) ? (s.toolIds as unknown as string[]) : [];
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.warn(
        `[agent-tools] built-in skill "${s.id}" references unknown tool ids: ${unknown.join(", ")}`,
      );
    }
  }
}
