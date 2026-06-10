import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Resolves and disposes the isolated workspace for an executor run.
import type { SandboxTarget } from "./types";

export interface SandboxHandle {
  // Where actions write during apply.
  workspacePath: string;
  // Isolated repo staging dir inside the workspace, never the live platform repo.
  repoRoot: string;
  target: SandboxTarget;
  dispose(): Promise<void>;
}

export interface AcquireSandboxInput {
  taskId: string;
  target: SandboxTarget;
  // Override workspace root (tests use a temp dir).
  workspaceRoot?: string;
}

export async function acquireSandbox(input: AcquireSandboxInput): Promise<SandboxHandle> {
  const root = input.workspaceRoot ?? join(tmpdir(), "scaffolder");
  const workspacePath = join(root, input.taskId);
  await fs.mkdir(workspacePath, { recursive: true });

  const repoRoot = join(workspacePath, "_repo");
  await fs.mkdir(repoRoot, { recursive: true });

  return {
    workspacePath,
    repoRoot,
    target: input.target,
    dispose: async () => {
      await fs.rm(workspacePath, { recursive: true, force: true });
    },
  };
}
