import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "../../types";
import { requireUserId } from "../core";

const search: RegisteredTool = {
  id: "catalog_search",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_search",
      description:
        "Search catalog entities (services, APIs, libraries, websites, databases, infrastructure) by name or description. Case-insensitive substring match. Returns up to 20 hits.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term (substring of name or description)." },
          kind: {
            type: "string",
            description:
              "Optional filter by kind: service | api | library | website | database | infrastructure.",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { query, kind } = args as { query: string; kind?: string };
    const where: Record<string, unknown> = {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    };
    if (kind) where.kind = kind;
    const rows = await prisma.catalogEntity.findMany({
      where,
      take: 20,
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, lifecycle: true, description: true },
    });
    return { hits: rows };
  },
};

const getEntity: RegisteredTool = {
  id: "catalog_get_entity",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_get_entity",
      description: "Fetch a catalog entity by id, including its owning teams.",
      parameters: {
        type: "object",
        properties: { entityId: { type: "string" } },
        required: ["entityId"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { entityId } = args as { entityId: string };
    const e = await prisma.catalogEntity.findUnique({
      where: { id: entityId },
      include: {
        owners: {
          include: { team: { select: { id: true, slug: true, name: true } } },
        },
      },
    });
    if (!e) return { error: "Not found" };
    return {
      id: e.id,
      name: e.name,
      kind: e.kind,
      lifecycle: e.lifecycle,
      description: e.description,
      repoUrl: e.repoUrl,
      tags: e.tags,
      owners: e.owners.map((o) => o.team),
    };
  },
};

const ownedByTeam: RegisteredTool = {
  id: "catalog_owned_by_team",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_owned_by_team",
      description: "List catalog entities owned by a team (by team slug).",
      parameters: {
        type: "object",
        properties: { teamSlug: { type: "string" } },
        required: ["teamSlug"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { teamSlug } = args as { teamSlug: string };
    const team = await prisma.team.findFirst({ where: { slug: teamSlug, deletedAt: null } });
    if (!team) return { error: "Team not found" };
    const rows = await prisma.catalogEntity.findMany({
      where: { owners: { some: { teamId: team.id } } },
      select: { id: true, name: true, kind: true, lifecycle: true },
      orderBy: { name: "asc" },
      take: 50,
    });
    return { team: { id: team.id, slug: team.slug, name: team.name }, entities: rows };
  },
};

export const catalogGroup: ToolGroup = {
  meta: {
    id: "catalog",
    label: "Katalog",
    description: "Katalog varlıklarını arama ve görüntüleme.",
    order: 40,
  },
  tools: [search, getEntity, ownedByTeam],
};
