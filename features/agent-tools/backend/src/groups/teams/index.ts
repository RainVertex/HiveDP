import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "../../types";
import { requireUserId } from "../core";

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

const listForUser: RegisteredTool = {
  id: "teams_list_user",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_list_user",
      description:
        "List all teams that another user (not the caller) is a member of, identified by their username (GitHub login), email, or display name. Returns the resolved user plus each team's slug, name, description, and that user's role. If the identifier matches more than one person, returns a `candidates` list to disambiguate. For the current user, use teams_list_mine instead.",
      parameters: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The target user's GitHub login (username), email, or display name.",
          },
        },
        required: ["username"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const q = String((args as { username?: string }).username ?? "").trim();
    if (!q) return { error: "username is required" };

    // Exact match on a unique handle first; fall back to a fuzzy search.
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { githubLogin: { equals: q, mode: "insensitive" } },
          { email: { equals: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, githubLogin: true, displayName: true, email: true },
    });

    if (!user) {
      const matches = await prisma.user.findMany({
        where: {
          OR: [
            { githubLogin: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, githubLogin: true, displayName: true, email: true },
        take: 6,
      });
      if (matches.length === 0) return { error: `No user found matching '${q}'.` };
      if (matches.length > 1) {
        return {
          candidates: matches.map((m) => ({
            username: m.githubLogin,
            displayName: m.displayName,
            email: m.email,
          })),
        };
      }
      user = matches[0];
    }

    const memberships = await prisma.teamMembership.findMany({
      where: { userId: user.id, team: { deletedAt: null } },
      include: {
        team: { select: { id: true, slug: true, name: true, description: true } },
      },
    });
    return {
      user: {
        id: user.id,
        username: user.githubLogin,
        displayName: user.displayName,
        email: user.email,
      },
      teams: memberships.map((m) => ({
        id: m.team.id,
        slug: m.team.slug,
        name: m.team.name,
        description: m.team.description,
        role: m.role,
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

export const teamsGroup: ToolGroup = {
  meta: {
    id: "teams",
    label: "Takımlar",
    description: "Takım listeleme ve üyelik sorguları.",
    order: 20,
  },
  tools: [listMine, listForUser, getTeam, listMembers],
};
