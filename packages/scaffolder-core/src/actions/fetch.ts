// Action that renders a skeleton directory into the workspace via Nunjucks.

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { hasTemplating, renderTemplate } from "../render";
import type { Mutation } from "../types";
import { makeUnifiedDiff } from "../diff";
import type { Action, ReadCtx, WriteCtx } from "./types";

const fetchTemplateInput = z.object({
  // Absolute path so this action stays filesystem-agnostic.
  skeletonPath: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  // Substring-matched files copied verbatim (skip Nunjucks); useful for binary fixtures.
  skipRender: z.array(z.string()).optional(),
  // Filename markers like __PASCAL__ since filenames cannot hold Nunjucks expressions on Windows.
  pathSubstitutions: z.record(z.string(), z.string()).optional(),
});

type FetchInput = z.infer<typeof fetchTemplateInput>;

interface SkeletonFile {
  relativePath: string;
  source: string;
}

async function readSkeleton(skeletonPath: string): Promise<SkeletonFile[]> {
  const out: SkeletonFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const source = await fs.readFile(abs, "utf8");
        out.push({ relativePath: relative(skeletonPath, abs), source });
      }
    }
  }
  await walk(skeletonPath);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

function shouldSkipRender(relPath: string, skipRender?: string[]): boolean {
  if (!skipRender) return false;
  return skipRender.some((needle) => relPath.includes(needle));
}

function renderRelativePath(
  relPath: string,
  values: Record<string, unknown>,
  pathSubstitutions: Record<string, string> | undefined,
): string {
  // Strip a trailing .tmpl marker so Page.tsx.tmpl becomes Page.tsx.
  let out = relPath.endsWith(".tmpl") ? relPath.slice(0, -".tmpl".length) : relPath;
  if (pathSubstitutions) {
    for (const [marker, replacement] of Object.entries(pathSubstitutions)) {
      out = out.split(marker).join(replacement);
    }
  }
  return hasTemplating(out) ? renderTemplate(out, values) : out;
}

function ensureWorkspaceRelative(workspacePath: string, requested: string): string {
  if (isAbsolute(requested)) {
    throw new Error(`fetch:template output path must be relative: ${requested}`);
  }
  const abs = join(workspacePath, requested);
  const rel = relative(workspacePath, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`fetch:template output path escapes workspace: ${requested}`);
  }
  return abs;
}

export const fetchTemplateAction: Action<FetchInput, { files: string[] }> = {
  id: "fetch:template",
  description: "Renders a skeleton directory into the workspace via Nunjucks.",
  schema: fetchTemplateInput,
  capabilities: ["fs:write"],
  async match() {
    return "absent";
  },
  async diff(input, _ctx: ReadCtx) {
    const files = await readSkeleton(input.skeletonPath);
    const mutations: Mutation[] = [];
    for (const f of files) {
      const outPath = renderRelativePath(f.relativePath, input.values, input.pathSubstitutions);
      const rendered = shouldSkipRender(f.relativePath, input.skipRender)
        ? f.source
        : renderTemplate(f.source, input.values);
      mutations.push({
        kind: "fs.write",
        path: outPath,
        contentDiff: makeUnifiedDiff(null, rendered, outPath),
      });
    }
    return mutations;
  },
  async apply(input, ctx: WriteCtx) {
    const files = await readSkeleton(input.skeletonPath);
    const written: string[] = [];
    for (const f of files) {
      if (ctx.signal.aborted) throw new Error("cancelled");
      const outRel = renderRelativePath(f.relativePath, input.values, input.pathSubstitutions);
      const outAbs = ensureWorkspaceRelative(ctx.workspacePath, outRel);
      const rendered = shouldSkipRender(f.relativePath, input.skipRender)
        ? f.source
        : renderTemplate(f.source, input.values);
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fetch:template ${outRel}`);
      } else {
        await fs.mkdir(dirname(outAbs), { recursive: true });
        await fs.writeFile(outAbs, rendered, "utf8");
        ctx.logger.info(`fetch:template ${outRel}`);
      }
      written.push(outRel);
    }
    return {
      output: { files: written },
      // Executor disposes the whole workspace, so no per-file compensation is needed.
      compensation: { kind: "noop", reason: "workspace cleared by executor" },
    };
  },
};

export { fetchTemplateInput };
