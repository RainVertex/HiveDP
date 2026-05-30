import { prisma, Prisma, type CatalogEntity } from "@internal/db";
import {
  discoverAndPersist,
  parseGithubUrl,
  type DiscoverAndPersistResult,
} from "@feature/scaffolder-backend";
import { registerTools, type RegisteredTool } from "@internal/llm-core";

// Catalog tools for the Catalog Enricher agent (lookup / discover /
// propose-drift). Registered into the shared llm-core registry at server
// startup via registerAgentTools(). Kept in the agent domain rather than in
// llm-core so the shared package carries no feature-specific dependencies.

export const CATALOG_TOOLS: RegisteredTool[] = [
  {
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
    handler: async (args): Promise<Partial<CatalogEntity> | null> => {
      const { entityId } = args as { entityId: string };
      if (typeof entityId !== "string" || !entityId) {
        throw new Error("entityId required");
      }
      return prisma.catalogEntity.findUnique({
        where: { id: entityId },
        include: {
          owners: {
            include: { team: { select: { id: true, slug: true, name: true } } },
          },
        },
      });
    },
  },
  {
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
    handler: async (args): Promise<DiscoverAndPersistResult> => {
      const { repoUrl } = args as { repoUrl: string };
      if (typeof repoUrl !== "string" || !repoUrl) {
        throw new Error("repoUrl required");
      }
      const parsed = parseGithubUrl(repoUrl);
      if (!parsed) throw new Error(`repoUrl is not a github URL: ${repoUrl}`);
      return discoverAndPersist({
        source: "github",
        target: `${parsed.owner}/${parsed.repo}`,
        token: process.env.GITHUB_TOKEN,
      });
    },
  },
  {
    id: "catalog_propose_drift",
    openaiDef: {
      type: "function",
      function: {
        name: "catalog_propose_drift",
        description:
          "Record a proposed change to a CatalogEntity for human review. Writes a CatalogDrift row with status=open. The diff should describe what fields differ and what the new values would be.",
        parameters: {
          type: "object",
          properties: {
            entityId: { type: "string" },
            kind: {
              type: "string",
              enum: ["field-mismatch", "missing-yaml", "yaml-only", "owner-stale"],
            },
            diff: {
              type: "object",
              description:
                "{fields: string[], before: object, after: object, reason?: string}. before is the current DB row (subset); after is the proposed values.",
            },
          },
          required: ["entityId", "kind", "diff"],
        },
      },
    },
    handler: async (args): Promise<{ driftId: string }> => {
      const { entityId, kind, diff } = args as {
        entityId: string;
        kind: string;
        diff: Record<string, unknown>;
      };
      if (typeof entityId !== "string" || !entityId) throw new Error("entityId required");
      if (typeof kind !== "string" || !kind) throw new Error("kind required");
      if (!diff || typeof diff !== "object") throw new Error("diff required");
      const created = await prisma.catalogDrift.create({
        data: {
          entityId,
          kind,
          diff: diff as Prisma.InputJsonValue,
          proposedBy: "agent",
        },
        select: { id: true },
      });
      return { driftId: created.id };
    },
  },
];

/** Register the catalog tools into the shared registry at server startup. */
export function registerAgentTools(): void {
  registerTools(CATALOG_TOOLS);
}
