import {
  discoverAndPersist,
  parseGithubUrl,
  type DiscoverAndPersistResult,
} from "@feature/scaffolder-backend/contract";
import { resolveOrgScope, isOrgVisible } from "@feature/catalog-backend/contract";
import type { RegisteredTool } from "@internal/llm-core";
import { getEntityWithOwners } from "./queries";

// Catalog reads used by the enricher: fetch the DB row, and discover/parse a repo's catalog-info.yaml.
// Repo file reads and the PR write live in the repo group; these stay catalog-domain.

export const lookup: RegisteredTool = {
  id: "catalog_lookup",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_lookup",
      description: "Fetch the current CatalogEntity row from the database.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "CatalogEntity.id" },
        },
        required: ["entityId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { entityId } = args as { entityId: string };
    if (typeof entityId !== "string" || !entityId) {
      throw new Error("entityId required");
    }
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const entity = await getEntityWithOwners(entityId);
    if (entity && !isOrgVisible(scope, entity.accountLogin)) {
      return { error: "Org membership required", code: "forbidden" };
    }
    return entity;
  },
};

export const discover: RegisteredTool = {
  id: "catalog_discover",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_discover",
      description:
        "Fetch and parse catalog-info.yaml from a GitHub repo. Walks for catalog-info.yaml / .yml at the repo root. Returns the parsed entity payload and any parse errors.",
      parameters: {
        type: "object",
        properties: {
          repoUrl: {
            type: "string",
            description: "Full https://github.com/org/repo URL (the repo to inspect).",
          },
        },
        required: ["repoUrl"],
      },
    },
  },
  handler: async (
    args,
    ctx,
  ): Promise<DiscoverAndPersistResult | { error: string; code: string }> => {
    const { repoUrl } = args as { repoUrl: string };
    if (typeof repoUrl !== "string" || !repoUrl) {
      throw new Error("repoUrl required");
    }
    const parsed = parseGithubUrl(repoUrl);
    if (!parsed) throw new Error(`repoUrl is not a github URL: ${repoUrl}`);
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    if (!isOrgVisible(scope, parsed.owner)) {
      return { error: "Org membership required", code: "forbidden" };
    }
    return discoverAndPersist({
      source: "github",
      target: `${parsed.owner}/${parsed.repo}`,
    });
  },
};
