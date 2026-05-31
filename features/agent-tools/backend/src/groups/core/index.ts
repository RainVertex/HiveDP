import { prisma } from "@internal/db";
import type { RegisteredTool, ToolContext } from "@internal/llm-core";
import type { ToolGroup } from "../../types";

// Bootstrapping tools (whoami, get_today) every conversation should call once.

const whoami: RegisteredTool = {
  id: "whoami",
  openaiDef: {
    type: "function",
    function: {
      name: "whoami",
      description:
        "Identify the current user. Returns name, email, role, team memberships, and department memberships. Call once at the start of a conversation.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.userId) return { error: "Not authenticated" };
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
        memberships: {
          where: { team: { deletedAt: null } },
          select: {
            role: true,
            team: { select: { id: true, slug: true, name: true } },
          },
        },
        departmentMemberships: {
          select: {
            role: true,
            department: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });
    if (!user) return { error: "User not found" };
    return {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      isAdmin: ctx.isAdmin,
      teams: user.memberships.map((m) => ({
        id: m.team.id,
        slug: m.team.slug,
        name: m.team.name,
        role: m.role,
      })),
      departments: user.departmentMemberships.map((m) => ({
        id: m.department.id,
        slug: m.department.slug,
        name: m.department.name,
        role: m.role,
      })),
    };
  },
};

const getToday: RegisteredTool = {
  id: "get_today",
  openaiDef: {
    type: "function",
    function: {
      name: "get_today",
      description:
        "Return today's date in ISO format (YYYY-MM-DD) along with the current weekday and ISO timestamp in UTC. Call this before answering any 'today' or 'this week' question.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async () => {
    const now = new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    return { date, weekday, isoTimestamp: iso };
  },
};

export function requireUserId(ctx: ToolContext): string {
  if (!ctx.userId) throw new Error("Not authenticated");
  return ctx.userId;
}

export const coreGroup: ToolGroup = {
  meta: {
    id: "core",
    label: "Genel",
    description: "Kullanıcı kimliği ve tarih gibi temel araçlar.",
    order: 10,
  },
  tools: [whoami, getToday],
};
