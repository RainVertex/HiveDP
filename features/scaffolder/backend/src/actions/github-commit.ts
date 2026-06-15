import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Octokit as OctokitClient } from "octokit";

// Builds a git tree from a rendered workspace via the GitHub Git Data API. Commits created with an
// installation-scoped Octokit are auto-attributed to the GitHub App bot, no local git identity needed.

const EXCLUDED_TOP_LEVEL = new Set([".git", "_repo", "_pr_checkout"]);

interface WorkspaceBlob {
  path: string;
  base64: string;
}

async function collectFiles(root: string): Promise<WorkspaceBlob[]> {
  const out: WorkspaceBlob[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (EXCLUDED_TOP_LEVEL.has(rel.split(/[\\/]/)[0]!)) continue;
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) {
        const buf = await fs.readFile(abs);
        out.push({ path: rel.split(sep).join("/"), base64: buf.toString("base64") });
      }
    }
  }
  try {
    await walk(root);
  } catch {
    // empty or missing workspace
  }
  return out;
}

export interface BuildTreeInput {
  octo: OctokitClient;
  owner: string;
  repo: string;
  dir: string;
  // Layer the new files on top of an existing tree (for PRs against a populated repo).
  baseTreeSha?: string;
}

export interface BuildTreeResult {
  treeSha: string;
  fileCount: number;
}

// Returns the new tree sha plus how many files it carried. fileCount 0 means nothing was rendered,
// the caller decides whether that is an error. treeSha equal to baseTreeSha means no net change.
export async function buildTreeFromWorkspace(input: BuildTreeInput): Promise<BuildTreeResult> {
  const { octo, owner, repo, dir, baseTreeSha } = input;
  const files = await collectFiles(dir);
  if (files.length === 0) return { treeSha: baseTreeSha ?? "", fileCount: 0 };

  const tree = await Promise.all(
    files.map(async (file) => {
      const blob = await octo.rest.git.createBlob({
        owner,
        repo,
        content: file.base64,
        encoding: "base64",
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data.sha,
      };
    }),
  );

  const created = await octo.rest.git.createTree({
    owner,
    repo,
    tree,
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
  });
  return { treeSha: created.data.sha, fileCount: files.length };
}
