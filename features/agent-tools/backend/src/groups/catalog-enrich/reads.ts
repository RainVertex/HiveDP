import {
  discoverAndPersist,
  parseGithubUrl,
  type DiscoverAndPersistResult,
} from "@feature/scaffolder-backend/contract";
import { octokitForInstallation } from "@feature/integrations-backend/contract";
import { resolveOrgScope, isOrgVisible } from "@feature/catalog-backend/contract";
import type { RegisteredTool } from "@internal/llm-core";
import { loadEntityRepo } from "./repo";
import { getEntityWithOwners } from "./queries";

// Catalog enrichment read tools: look up the DB row, discover and inspect the entity's GitHub repo.

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

export const readRepo: RegisteredTool = {
  id: "catalog_read_repo",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_read_repo",
      description:
        "Inspect the entity's GitHub repository to infer catalog metadata: returns the repo description, topics, primary language, default branch, archived flag, and the root file listing. Call this to decide what catalog-info.yaml should contain.",
      parameters: {
        type: "object",
        properties: { entityId: { type: "string", description: "CatalogEntity.id" } },
        required: ["entityId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const repo = await loadEntityRepo((args as { entityId?: unknown }).entityId, scope);
    if ("error" in repo) return repo;
    const octo = await octokitForInstallation(repo.installationId);
    const meta = await octo.rest.repos.get({ owner: repo.owner, repo: repo.repo });
    let rootFiles: string[] = [];
    try {
      const root = await octo.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path: "",
      });
      if (Array.isArray(root.data)) {
        rootFiles = root.data.map((f) => (f as { name: string }).name);
      }
    } catch {
      // Root listing is best-effort. An empty repo or permission gap just yields no files.
    }
    return {
      name: meta.data.name,
      description: meta.data.description,
      topics: (meta.data as { topics?: string[] }).topics ?? [],
      primaryLanguage: meta.data.language ?? null,
      defaultBranch: meta.data.default_branch,
      archived: meta.data.archived,
      rootFiles,
    };
  },
};

export const readFile: RegisteredTool = {
  id: "catalog_read_file",
  openaiDef: {
    type: "function",
    function: {
      name: "catalog_read_file",
      description:
        "Read a single text file from the entity's repo (e.g. README.md, package.json, pyproject.toml, go.mod, CODEOWNERS, catalog-info.yaml). Returns the file content (truncated if large) or { missing: true } if absent.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "CatalogEntity.id" },
          path: { type: "string", description: "Repo-relative file path, e.g. README.md" },
        },
        required: ["entityId", "path"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { entityId, path } = args as { entityId?: unknown; path?: unknown };
    if (typeof path !== "string" || !path) return { error: "path required", code: "bad_args" };
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const repo = await loadEntityRepo(entityId, scope);
    if ("error" in repo) return repo;
    const octo = await octokitForInstallation(repo.installationId);
    try {
      const res = await octo.rest.repos.getContent({ owner: repo.owner, repo: repo.repo, path });
      if (Array.isArray(res.data)) return { error: "path is a directory", code: "is_dir" };
      const data = res.data as { type?: string; encoding?: string; content?: string };
      if (data.type !== "file" || data.encoding !== "base64" || !data.content) {
        return { error: "not a readable text file", code: "unreadable" };
      }
      let content = Buffer.from(data.content, "base64").toString("utf8");
      const MAX = 60_000;
      const truncated = content.length > MAX;
      if (truncated) content = content.slice(0, MAX);
      return { path, content, truncated };
    } catch (err) {
      if ((err as { status?: number }).status === 404) return { path, missing: true };
      return { error: (err as Error).message, code: "read_failed" };
    }
  },
};
