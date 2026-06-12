import type { RegisteredTool } from "@internal/llm-core";
import { resolveOrgScope } from "@feature/catalog-backend/contract";
import { requireUserId } from "../core";
import { searchEntities, getEntityById, entitiesOwnedByTeam } from "./queries";

export const search: RegisteredTool = {
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
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    return { hits: await searchEntities(query, scope, kind) };
  },
};

export const getEntity: RegisteredTool = {
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
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const e = await getEntityById(entityId, scope);
    return e ?? { error: "Not found" };
  },
};

export const ownedByTeam: RegisteredTool = {
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
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const result = await entitiesOwnedByTeam(teamSlug, scope);
    return result ?? { error: "Team not found" };
  },
};
