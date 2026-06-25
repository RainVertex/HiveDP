import type { RegisteredTool } from "@internal/llm-core";
import { resolveRepoClient } from "./resolve";
import { repoInfo, repoSearch, repoListDir, repoReadFile } from "./engine";

// One read engine, one set of tools, three possible targets. The target picks which repository the
// call runs against; everything else (info, grep, list, read) is identical regardless of target.

const targetParam = {
  type: "object",
  description:
    "Which repository to operate on. kind 'platform' is the platform's own source repo (pass no other field, use it to answer how the platform works or how to change it). kind 'project' is a project's connected repo (set projectId to the project.id). kind 'entity' is a catalog entity's repo (set entityId to the CatalogEntity.id).",
  properties: {
    kind: {
      type: "string",
      enum: ["platform", "project", "entity"],
      description: "platform | project | entity",
    },
    projectId: { type: "string", description: "Required when kind is 'project' (the project.id)." },
    entityId: { type: "string", description: "Required when kind is 'entity' (CatalogEntity.id)." },
  },
  required: ["kind"],
};

export const repoInfoTool: RegisteredTool = {
  id: "repo_info",
  openaiDef: {
    type: "function",
    function: {
      name: "repo_info",
      description:
        "Get an overview of the target repository: full name, description, default branch, primary language, topics, archived flag, and the root file/directory listing. Call this first to orient yourself before searching or reading files.",
      parameters: {
        type: "object",
        properties: { target: targetParam },
        required: ["target"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { target } = args as { target: unknown };
    const client = await resolveRepoClient(ctx, target);
    if ("error" in client) return client;
    return repoInfo(client);
  },
};

export const repoSearchTool: RegisteredTool = {
  id: "repo_search",
  openaiDef: {
    type: "function",
    function: {
      name: "repo_search",
      description:
        "Search the target repository by both file path/name AND file contents (a real grep). Use it first to locate where something lives, e.g. a component, route, config, setting, or framework usage. Content matches include the file path and matching line numbers. Prefer it over manually listing directories.",
      parameters: {
        type: "object",
        properties: {
          target: targetParam,
          query: {
            type: "string",
            description:
              'Search terms, e.g. "auth", "Dockerfile", "useQuery". Plain words, not GitHub search qualifiers.',
          },
        },
        required: ["target", "query"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { target, query } = args as { target: unknown; query?: unknown };
    const client = await resolveRepoClient(ctx, target);
    if ("error" in client) return client;
    return repoSearch(client, typeof query === "string" ? query : "", ctx.signal);
  },
};

export const repoListDirTool: RegisteredTool = {
  id: "repo_list_dir",
  openaiDef: {
    type: "function",
    function: {
      name: "repo_list_dir",
      description:
        "List the contents of a directory in the target repository. Use it to browse the tree. Returns each entry's name, path, and type (file or dir). Prefer repo_search to find things; fall back to this only when search returns nothing.",
      parameters: {
        type: "object",
        properties: {
          target: targetParam,
          path: {
            type: "string",
            description: 'Repo-relative directory path, e.g. "src". Omit or pass "" for the root.',
          },
        },
        required: ["target"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { target, path } = args as { target: unknown; path?: unknown };
    const client = await resolveRepoClient(ctx, target);
    if ("error" in client) return client;
    return repoListDir(client, typeof path === "string" ? path : "");
  },
};

export const repoReadFileTool: RegisteredTool = {
  id: "repo_read_file",
  openaiDef: {
    type: "function",
    function: {
      name: "repo_read_file",
      description:
        "Read a single text file from the target repository. Returns the file content (truncated if very large) or { missing: true } if the path does not exist. Use it for the README and manifests (package.json, pyproject.toml, go.mod, CODEOWNERS, catalog-info.yaml, etc.).",
      parameters: {
        type: "object",
        properties: {
          target: targetParam,
          path: { type: "string", description: 'Repo-relative file path, e.g. "README.md".' },
        },
        required: ["target", "path"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { target, path } = args as { target: unknown; path?: unknown };
    const client = await resolveRepoClient(ctx, target);
    if ("error" in client) return client;
    return repoReadFile(client, typeof path === "string" ? path : "");
  },
};
