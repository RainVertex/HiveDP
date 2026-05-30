import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "./core";

const listMine: RegisteredTool = {
  id: "teams_list_mine",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_list_mine",
      description:
        "List all teams the current user is a member of. Returns slug, name, description, and the user's role (lead or member) for each.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    const memberships = await prisma.teamMembership.findMany({
      where: { userId, team: { deletedAt: null } },
      include: {
        team: { select: { id: true, slug: true, name: true, description: true } },
      },
    });
    return {
      teams: memberships.map((m) => ({
        id: m.team.id,
        slug: m.team.slug,
        name: m.team.name,
        description: m.team.description,
        myRole: m.role,
      })),
    };
  },
};

const getTeam: RegisteredTool = {
  id: "teams_get",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_get",
      description: "Fetch a single team by slug. Public — any authenticated user can read.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { slug } = args as { slug: string };
    const team = await prisma.team.findFirst({
      where: { slug, deletedAt: null },
      include: {
        department: { select: { id: true, slug: true, name: true } },
        _count: { select: { memberships: true } },
      },
    });
    if (!team) return { error: "Not found" };
    return {
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      department: team.department,
      memberCount: team._count.memberships,
      source: team.source,
    };
  },
};

const listMembers: RegisteredTool = {
  id: "teams_list_members",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_list_members",
      description:
        "List the members of a team by slug, including each member's role (lead or member). The caller must be a member of the team or an admin.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { slug } = args as { slug: string };
    const team = await prisma.team.findFirst({ where: { slug, deletedAt: null } });
    if (!team) return { error: "Not found" };
    if (!ctx.isAdmin) {
      const m = await prisma.teamMembership.findUnique({
        where: { teamId_userId: { teamId: team.id, userId } },
      });
      if (!m) return { error: "Not authorized to view this team's members" };
    }
    const members = await prisma.teamMembership.findMany({
      where: { teamId: team.id },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
    return {
      team: { id: team.id, slug: team.slug, name: team.name },
      members: members.map((m) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        email: m.user.email,
        role: m.role,
      })),
    };
  },
};

export const TEAMS_READ_TOOLS: RegisteredTool[] = [listMine, getTeam, listMembers];
export const TEAMS_READ_TOOL_IDS = TEAMS_READ_TOOLS.map((t) => t.id);
