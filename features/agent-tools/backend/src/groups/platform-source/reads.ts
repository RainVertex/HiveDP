import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "../core";
import { resolveSelfRepoClient } from "../source-common/resolve";
import { repoInfo, repoSearch, repoListDir, repoReadFile } from "../source-common/engine";

// Read-only tools that let the Platform Assistant inspect the platform's own GitHub repository,
// so it can answer "how does this app work" and "how do I change X" questions from the real source.
// The repo is resolved from the catalog entity tagged "platform" (see source-common/resolve.ts).

export const sourceInfo: RegisteredTool = {
  id: "platform_source_info",
  openaiDef: {
    type: "function",
    function: {
      name: "platform_source_info",
      description:
        "Get an overview of the platform's own source repository: full name, description, default branch, primary language, topics, and the root file/directory listing. Call this first to orient yourself before searching or reading files.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    requireUserId(ctx);
    const client = await resolveSelfRepoClient();
    if ("error" in client) return client;
    return repoInfo(client);
  },
};

export const sourceSearch: RegisteredTool = {
  id: "platform_source_search",
  openaiDef: {
    type: "function",
    function: {
      name: "platform_source_search",
      description:
        "Search the platform's own repository by both file path/name AND file contents (a real grep, scoped to the configured repo). Use it first to locate where something lives, e.g. a component, route, setting, the brand name, or an asset. Content matches include the file path and matching line numbers. This is the fastest way to find things, prefer it over manually listing directories.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search terms, e.g. "HiveDP", "ThemeSwitcher", "favicon". Plain words, not GitHub search qualifiers.',
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { query } = args as { query?: unknown };
    const client = await resolveSelfRepoClient();
    if ("error" in client) return client;
    return repoSearch(client, typeof query === "string" ? query : "", ctx.signal);
  },
};

export const sourceListDir: RegisteredTool = {
  id: "platform_source_list_dir",
  openaiDef: {
    type: "function",
    function: {
      name: "platform_source_list_dir",
      description:
        "List the contents of a directory in the platform's own source repository. Use it to browse the tree. Returns each entry's name, path, and type (file or dir).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Repo-relative directory path, e.g. "apps/web/src". Omit or pass "" for the root.',
          },
        },
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const path =
      typeof (args as { path?: unknown }).path === "string" ? (args as { path: string }).path : "";
    const client = await resolveSelfRepoClient();
    if ("error" in client) return client;
    return repoListDir(client, path);
  },
};

export const sourceReadFile: RegisteredTool = {
  id: "platform_source_read_file",
  openaiDef: {
    type: "function",
    function: {
      name: "platform_source_read_file",
      description:
        "Read a single text file from the platform's own source repository. Returns the file content (truncated if very large) or { missing: true } if the path does not exist.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Repo-relative file path, e.g. "apps/web/src/App.tsx".',
          },
        },
        required: ["path"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const { path } = args as { path?: unknown };
    const client = await resolveSelfRepoClient();
    if ("error" in client) return client;
    return repoReadFile(client, typeof path === "string" ? path : "");
  },
};
