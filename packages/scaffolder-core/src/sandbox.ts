import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Resolves and disposes the workspace and repo paths for an executor run.
import type { SandboxTarget } from "./types";

export interface SandboxHandle {
  // Where actions write during apply.
  workspacePath: string;
  // Where repo:scaffold and wire:* commit final outputs.
  repoRoot: string;
  target: SandboxTarget;
  dispose(): Promise<void>;
}

export interface AcquireSandboxInput {
  taskId: string;
  target: SandboxTarget;
  liveRepoRoot: string;
  // Override workspace root (tests use a temp dir).
  workspaceRoot?: string;
}

export async function acquireSandbox(input: AcquireSandboxInput): Promise<SandboxHandle> {
  const root = input.workspaceRoot ?? join(tmpdir(), "scaffolder");
  const workspacePath = join(root, input.taskId);
  await fs.mkdir(workspacePath, { recursive: true });

  let repoRoot: string;
  switch (input.target) {
    case "main":
    case "branch":
      repoRoot = input.liveRepoRoot;
      break;
    case "worktree":
      repoRoot = join(workspacePath, "_repo");
      await fs.mkdir(repoRoot, { recursive: true });
      break;
  }

  return {
    workspacePath,
    repoRoot,
    target: input.target,
    dispose: async () => {
      // Clean the workspace only, never touch the live repoRoot.
      await fs.rm(workspacePath, { recursive: true, force: true });
    },
  };
}
