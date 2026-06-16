// fetch:remote-template: downloads a skeleton from a GitHub repo as a tarball, extracts and renders it
// in memory, then writes only the rendered output into the workspace (skeleton bytes never touch disk).
import { z } from "zod";
import { parseTarGzip } from "nanotar";
import {
  renderSkeletonInto,
  type Action,
  type Mutation,
  type SkeletonFile,
  type WriteCtx,
} from "@internal/scaffolder-core";

const fetchRemoteTemplateInput = z.object({
  repo: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be "owner/repo"')
    .describe("GitHub repository holding the skeleton, as owner/repo"),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe("Branch or tag to fetch, pin to a tag for reproducible plans"),
  path: z
    .string()
    .default(".")
    .describe("Subdirectory within the repo to render, defaults to the repo root"),
  values: z
    .record(z.string(), z.unknown())
    .describe("Values exposed to skeleton files as ${{ values.* }}"),
  skipRender: z
    .array(z.string())
    .optional()
    .describe("Substring-matched files copied verbatim without rendering"),
  pathSubstitutions: z
    .record(z.string(), z.string())
    .optional()
    .describe("Filename marker replacements, e.g. __PASCAL__"),
  tokenSecret: z
    .string()
    .default("GITHUB_TOKEN")
    .describe("Platform secret holding the GitHub token, only needed for private repos"),
});

type FetchRemoteTemplateInput = z.infer<typeof fetchRemoteTemplateInput>;

function normalizeSubPath(path: string): string {
  const trimmed = path === "." ? "" : path.replace(/^\/+|\/+$/g, "");
  if (trimmed.split("/").includes("..")) {
    throw new Error(`fetch:remote-template path escapes the repo: ${path}`);
  }
  return trimmed;
}

// GitHub wraps tarball contents in a generated "owner-repo-<sha>/" top-level directory.
function stripArchivePrefix(name: string): string {
  const slash = name.indexOf("/");
  return slash === -1 ? "" : name.slice(slash + 1);
}

export const fetchRemoteTemplateAction: Action<FetchRemoteTemplateInput, { files: string[] }> = {
  id: "fetch:remote-template",
  description:
    "Download a skeleton from a GitHub repo at a ref and render it into the workspace via Nunjucks.",
  schema: fetchRemoteTemplateInput,
  capabilities: ["fs:write", "repo:read", "network:external", "secrets:read:GITHUB_TOKEN"],
  async match() {
    return "absent";
  },
  async diff(input): Promise<Mutation[]> {
    const at = input.ref ? `@${input.ref}` : "";
    return [
      { kind: "debug.log", message: `fetch:remote-template ${input.path} from ${input.repo}${at}` },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    const at = input.ref ? `@${input.ref}` : "";
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] fetch:remote-template would fetch ${input.repo}${at}`);
      return { output: { files: [] }, compensation: { kind: "noop", reason: "dry run" } };
    }

    const [owner, repo] = input.repo.split("/");
    const token = ctx.secrets.tryRead(input.tokenSecret);
    const refPath = input.ref ? "/" + input.ref.split("/").map(encodeURIComponent).join("/") : "";
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball${refPath}`, {
      headers: {
        "User-Agent": "scaffolder-fetch-remote-template",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ctx.signal,
    });
    if (!res.ok) {
      throw new Error(
        `fetch:remote-template: GitHub returned ${res.status} for ${input.repo}${at}`,
      );
    }
    const archive = new Uint8Array(await res.arrayBuffer());

    const subPath = normalizeSubPath(input.path);
    const entries = await parseTarGzip(archive);
    const files: SkeletonFile[] = [];
    for (const entry of entries) {
      if (entry.type !== "file") continue;
      const full = stripArchivePrefix(entry.name);
      if (!full) continue;
      if (subPath) {
        if (!full.startsWith(`${subPath}/`)) continue;
        files.push({ relativePath: full.slice(subPath.length + 1), source: entry.text });
      } else {
        files.push({ relativePath: full, source: entry.text });
      }
    }

    if (subPath && files.length === 0) {
      throw new Error(
        `fetch:remote-template: path "${input.path}" not found in ${input.repo}${at}`,
      );
    }

    const written = await renderSkeletonInto({
      files,
      values: input.values,
      skipRender: input.skipRender,
      pathSubstitutions: input.pathSubstitutions,
      workspacePath: ctx.workspacePath,
      dryRun: false,
      signal: ctx.signal,
      logger: ctx.logger,
    });
    ctx.logger.info(
      `fetch:remote-template rendered ${written.length} files from ${input.repo}${at}`,
    );
    return {
      output: { files: written },
      compensation: { kind: "noop", reason: "workspace cleared by executor" },
    };
  },
};

export { fetchRemoteTemplateInput };
