import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "../../types";
import { requireUserId } from "../core";

const listDepartments: RegisteredTool = {
  id: "org_list_departments",
  openaiDef: {
    type: "function",
    function: {
      name: "org_list_departments",
      description: "List all departments with their slug, name, and team count.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    requireUserId(ctx);
    const rows = await prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { teams: true, memberships: true } } },
    });
    return {
      departments: rows.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: d.name,
        teamCount: d._count.teams,
        memberCount: d._count.memberships,
      })),
    };
  },
};

const getDepartment: RegisteredTool = {
  id: "org_get_department",
  openaiDef: {
    type: "function",
    function: {
      name: "org_get_department",
      description: "Fetch a single department by slug, including its teams (slugs and names).",
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
    const dept = await prisma.department.findFirst({
      where: { slug },
      include: {
        teams: {
          where: { deletedAt: null },
          select: { id: true, slug: true, name: true },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!dept) return { error: "Not found" };
    return {
      id: dept.id,
      slug: dept.slug,
      name: dept.name,
      teams: dept.teams,
    };
  },
};

export const orgGroup: ToolGroup = {
  meta: {
    id: "org",
    label: "Organizasyon",
    description: "Departman listeleme ve detayları.",
    order: 50,
  },
  tools: [listDepartments, getDepartment],
};
