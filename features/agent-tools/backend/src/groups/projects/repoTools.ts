import type { RegisteredTool } from "@internal/llm-core";
import { resolveProjectRepoClient } from "../source-common/resolve";
import { repoInfo, repoSearch, repoListDir, repoReadFile } from "../source-common/engine";

// Read-only tools that let an agent inspect the GitHub repository a project is connected to (via its
// catalog entity), so the Task Planner can ground subtasks in the real codebase. Same read engine as the
// platform-source tools, scoped to a project and authorized by project membership.

const projectIdParam = {
  type: "string",
  description: "Id of the project (project.id from the input).",
};

export const projectRepoInfo: RegisteredTool = {
  id: "projects_repo_info",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_repo_info",
      description:
        "Get an overview of the repository a project is connected to: full name, description, default branch, primary language, topics, and the root file/directory listing. Call this first to orient yourself before searching or reading files. Returns a no_repo error when the project has no connected repository.",
      parameters: {
        type: "object",
        properties: { projectId: projectIdParam },
        required: ["projectId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { projectId } = args as { projectId: string };
    const client = await resolveProjectRepoClient(ctx, projectId);
    if ("error" in client) return client;
    return repoInfo(client);
  },
};

export const projectRepoSearch: RegisteredTool = {
  id: "projects_repo_search",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_repo_search",
      description:
        "Search the project's connected repository by both file path/name AND file contents (a real grep). Use it to locate where something lives, e.g. a component, route, config, or framework usage. Content matches include the file path and matching line numbers. Prefer it over manually listing directories.",
      parameters: {
        type: "object",
        properties: {
          projectId: projectIdParam,
          query: {
            type: "string",
            description:
              'Search terms, e.g. "auth", "Dockerfile", "useQuery". Plain words, not GitHub search qualifiers.',
          },
        },
        required: ["projectId", "query"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { projectId, query } = args as { projectId: string; query?: unknown };
    const client = await resolveProjectRepoClient(ctx, projectId);
    if ("error" in client) return client;
    return repoSearch(client, typeof query === "string" ? query : "", ctx.signal);
  },
};

export const projectRepoListDir: RegisteredTool = {
  id: "projects_repo_list_dir",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_repo_list_dir",
      description:
        "List the contents of a directory in the project's connected repository. Use it to browse the tree. Returns each entry's name, path, and type (file or dir).",
      parameters: {
        type: "object",
        properties: {
          projectId: projectIdParam,
          path: {
            type: "string",
            description: 'Repo-relative directory path, e.g. "src". Omit or pass "" for the root.',
          },
        },
        required: ["projectId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { projectId, path } = args as { projectId: string; path?: unknown };
    const client = await resolveProjectRepoClient(ctx, projectId);
    if ("error" in client) return client;
    return repoListDir(client, typeof path === "string" ? path : "");
  },
};

export const projectRepoReadFile: RegisteredTool = {
  id: "projects_repo_read_file",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_repo_read_file",
      description:
        "Read a single text file from the project's connected repository. Returns the file content (truncated if very large) or { missing: true } if the path does not exist. Use it for the README and manifests (package.json, pyproject.toml, go.mod, etc.).",
      parameters: {
        type: "object",
        properties: {
          projectId: projectIdParam,
          path: { type: "string", description: 'Repo-relative file path, e.g. "README.md".' },
        },
        required: ["projectId", "path"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { projectId, path } = args as { projectId: string; path?: unknown };
    const client = await resolveProjectRepoClient(ctx, projectId);
    if ("error" in client) return client;
    return repoReadFile(client, typeof path === "string" ? path : "");
  },
};
