import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { sha256 } from "../fingerprint";
import { makeUnifiedDiff } from "../diff";
import type { Mutation } from "../types";
import type { Action, ReadCtx, WriteCtx } from "./types";

// Filesystem scaffolder actions (write/delete/rename) and their compensations, scoped to the workspace.

function resolveInWorkspace(workspacePath: string, requested: string): string {
  if (isAbsolute(requested)) {
    throw new Error(`fs action path must be relative: ${requested}`);
  }
  const abs = resolve(workspacePath, requested);
  const rel = relative(workspacePath, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`fs action path escapes workspace: ${requested}`);
  }
  return abs;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const fsWriteInput = z.object({
  path: z.string().min(1),
  content: z.string(),
  mode: z.number().int().optional(),
});

export const fsWriteAction: Action<z.infer<typeof fsWriteInput>, { path: string }> = {
  id: "fs:write",
  description: "Write a file inside the task workspace.",
  schema: fsWriteInput,
  capabilities: ["fs:write"],
  async match(_input, _ctx: ReadCtx) {
    // ReadCtx is read-only repo probes, so plan always treats fs:write as creating; apply is idempotent.
    return "absent";
  },
  async diff(input, _ctx) {
    const mutation: Mutation = {
      kind: "fs.write",
      path: input.path,
      contentDiff: makeUnifiedDiff(null, input.content, input.path),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    };
    return [mutation];
  },
  async apply(input, ctx: WriteCtx) {
    const abs = resolveInWorkspace(ctx.workspacePath, input.path);
    const previous = await readIfExists(abs);
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] fs:write ${input.path} (${input.content.length} bytes)`);
      return { output: { path: input.path } };
    }
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, "utf8");
    if (input.mode !== undefined) await fs.chmod(abs, input.mode);
    ctx.logger.info(`fs:write ${input.path}`);
    return {
      output: { path: input.path },
      compensation: {
        kind: "fs.restore",
        path: input.path,
        previousContent: previous,
      },
    };
  },
};

const fsDeleteInput = z.object({
  path: z.string().min(1),
});

export const fsDeleteAction: Action<z.infer<typeof fsDeleteInput>, { path: string }> = {
  id: "fs:delete",
  description: "Delete a file inside the task workspace.",
  schema: fsDeleteInput,
  capabilities: ["fs:write"],
  async match() {
    return "absent";
  },
  async diff(input) {
    return [{ kind: "fs.delete", path: input.path, previousHash: "" }];
  },
  async apply(input, ctx: WriteCtx) {
    const abs = resolveInWorkspace(ctx.workspacePath, input.path);
    const previous = await readIfExists(abs);
    if (previous == null) {
      ctx.logger.warn(`fs:delete: ${input.path} did not exist; no-op`);
      return { output: { path: input.path } };
    }
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] fs:delete ${input.path}`);
      return { output: { path: input.path } };
    }
    await fs.unlink(abs);
    ctx.logger.info(`fs:delete ${input.path}`);
    return {
      output: { path: input.path },
      compensation: { kind: "fs.restore", path: input.path, previousContent: previous },
    };
  },
};

const fsRenameInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const fsRenameAction: Action<z.infer<typeof fsRenameInput>, { from: string; to: string }> = {
  id: "fs:rename",
  description: "Rename a file inside the task workspace.",
  schema: fsRenameInput,
  capabilities: ["fs:write"],
  async match() {
    return "absent";
  },
  async diff(input) {
    return [{ kind: "fs.rename", from: input.from, to: input.to }];
  },
  async apply(input, ctx: WriteCtx) {
    const fromAbs = resolveInWorkspace(ctx.workspacePath, input.from);
    const toAbs = resolveInWorkspace(ctx.workspacePath, input.to);
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] fs:rename ${input.from} -> ${input.to}`);
      return { output: input };
    }
    await fs.mkdir(dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    ctx.logger.info(`fs:rename ${input.from} -> ${input.to}`);
    return {
      output: input,
      compensation: { kind: "fs.unrename", from: input.from, to: input.to },
    };
  },
};

export async function replayFsCompensation(
  compensation: { kind: string; [k: string]: unknown },
  roots: { workspacePath: string; repoRoot: string },
): Promise<void> {
  if (compensation.kind === "noop") return;
  if (compensation.kind === "fs.restore") {
    const path = compensation.path as string;
    const abs = resolveInWorkspace(roots.workspacePath, path);
    const previous = compensation.previousContent as string | null;
    if (previous == null) {
      try {
        await fs.unlink(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    } else {
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, previous, "utf8");
    }
    return;
  }
  if (compensation.kind === "fs.unrename") {
    const fromAbs = resolveInWorkspace(roots.workspacePath, compensation.from as string);
    const toAbs = resolveInWorkspace(roots.workspacePath, compensation.to as string);
    await fs.mkdir(dirname(fromAbs), { recursive: true });
    await fs.rename(toAbs, fromAbs);
    return;
  }
  if (compensation.kind === "repo.restore") {
    const files = compensation.files as Array<{ path: string; previousContent: string | null }>;
    for (const file of files) {
      const abs = resolveInWorkspace(roots.repoRoot, file.path);
      if (file.previousContent == null) {
        try {
          await fs.unlink(abs);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      } else {
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, file.previousContent, "utf8");
      }
    }
    return;
  }
}

export async function hashFileIfExists(absPath: string): Promise<string> {
  try {
    const buf = await fs.readFile(absPath);
    return sha256(buf);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export function workspaceJoin(workspacePath: string, requested: string): string {
  return resolveInWorkspace(workspacePath, requested);
}

export const fsActions = [fsWriteAction, fsDeleteAction, fsRenameAction];

export { fsWriteInput, fsDeleteInput, fsRenameInput };

// Internal use only, re-export for tests.
export { join as _join };
