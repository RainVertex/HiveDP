// Shared skeleton renderer: renders an in-memory list of skeleton files into the workspace via Nunjucks.

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { hasTemplating, renderTemplate } from "../render";

export interface SkeletonFile {
  relativePath: string;
  source: string;
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
    throw new Error(`skeleton output path must be relative: ${requested}`);
  }
  const abs = join(workspacePath, requested);
  const rel = relative(workspacePath, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`skeleton output path escapes workspace: ${requested}`);
  }
  return abs;
}

export interface RenderSkeletonOptions {
  files: SkeletonFile[];
  values: Record<string, unknown>;
  skipRender?: string[];
  pathSubstitutions?: Record<string, string>;
  workspacePath: string;
  dryRun: boolean;
  signal: AbortSignal;
  logger: { info(msg: string): void };
}

// Renders an in-memory skeleton file list via Nunjucks and writes each result into the workspace.
export async function renderSkeletonInto(opts: RenderSkeletonOptions): Promise<string[]> {
  const written: string[] = [];
  for (const f of opts.files) {
    if (opts.signal.aborted) throw new Error("cancelled");
    const outRel = renderRelativePath(f.relativePath, opts.values, opts.pathSubstitutions);
    const outAbs = ensureWorkspaceRelative(opts.workspacePath, outRel);
    const rendered = shouldSkipRender(f.relativePath, opts.skipRender)
      ? f.source
      : renderTemplate(f.source, opts.values);
    if (opts.dryRun) {
      opts.logger.info(`[dry-run] render ${outRel}`);
    } else {
      await fs.mkdir(dirname(outAbs), { recursive: true });
      await fs.writeFile(outAbs, rendered, "utf8");
      opts.logger.info(`render ${outRel}`);
    }
    written.push(outRel);
  }
  return written;
}
