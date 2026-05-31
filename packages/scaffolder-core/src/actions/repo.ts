import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { makeUnifiedDiff } from "../diff";
import type { Mutation } from "../types";
import type { Action, ReadCtx, WriteCtx } from "./types";

// repo:scaffold action: copies rendered workspace files into the live repo with rollback capture.

const repoScaffoldInput = z.object({
  // Repo-relative directory where workspace contents land.
  targetDir: z.string().min(1),
  // Defaults to true; overwrite refusal is enforced regardless.
  preserveExisting: z.boolean().optional(),
});

type RepoScaffoldInput = z.infer<typeof repoScaffoldInput>;

function ensureRepoRelative(repoRoot: string, requested: string): string {
  if (isAbsolute(requested)) {
    throw new Error(`repo:scaffold targetDir must be relative: ${requested}`);
  }
  const abs = join(repoRoot, requested);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`repo:scaffold targetDir escapes repoRoot: ${requested}`);
  }
  return abs;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs));
      }
    }
  }
  try {
    await walk(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  out.sort();
  return out;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export const repoScaffoldAction: Action<
  RepoScaffoldInput,
  { written: string[]; targetDir: string }
> = {
  id: "repo:scaffold",
  description: "Move the rendered workspace into the live repo at targetDir.",
  schema: repoScaffoldInput,
  capabilities: ["fs:write", "fs:write:main"],
  async match(input, ctx: ReadCtx) {
    const exists = await ctx.existsInRepo(input.targetDir);
    return exists ? "drift" : "absent";
  },
  async diff(input, ctx: ReadCtx) {
    const exists = await ctx.existsInRepo(input.targetDir);
    if (exists) {
      // The workspace doesn't exist at plan time, so emit a single placeholder mutation.
      const mutations: Mutation[] = [
        {
          kind: "fs.write",
          path: input.targetDir,
          contentDiff: makeUnifiedDiff(
            "(existing target)",
            "(scaffold output applied)",
            input.targetDir,
          ),
        },
      ];
      return mutations;
    }
    return [];
  },
  async apply(input, ctx: WriteCtx) {
    const targetAbs = ensureRepoRelative(ctx.repoRoot, input.targetDir);
    const targetExists = await fs
      .stat(targetAbs)
      .then(() => true)
      .catch(() => false);
    if (targetExists && input.preserveExisting === false) {
      throw new Error(`repo:scaffold target ${input.targetDir} already exists`);
    }

    const files = await listFiles(ctx.workspacePath);
    const written: string[] = [];
    const previous: Array<{ path: string; previousContent: string | null }> = [];

    for (const rel of files) {
      if (ctx.signal.aborted) throw new Error("cancelled");
      const src = join(ctx.workspacePath, rel);
      const dest = join(targetAbs, rel);
      const content = await fs.readFile(src, "utf8");
      const before = await readIfExists(dest);

      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] repo:scaffold ${join(input.targetDir, rel)}`);
      } else {
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.writeFile(dest, content, "utf8");
        ctx.logger.info(`repo:scaffold ${join(input.targetDir, rel)}`);
      }
      written.push(rel);
      previous.push({ path: join(input.targetDir, rel), previousContent: before });
    }

    return {
      output: { written, targetDir: input.targetDir },
      compensation: { kind: "repo.restore", files: previous },
    };
  },
};

export { repoScaffoldInput };
