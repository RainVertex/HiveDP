import { promises as fs } from "node:fs";
import { join, dirname, relative } from "node:path";
import { z } from "zod";
import simpleGit, { type SimpleGit } from "simple-git";
import type { Octokit as OctokitClient } from "octokit";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";

// publish:github:pr action: pushes the rendered workspace as a branch on an existing repo and opens a PR.

// octokit v5 is ESM-only and breaks the CJS loader on static import, so defer it to apply().
async function loadOctokit(): Promise<typeof OctokitClient> {
  const mod = await import("octokit");
  return mod.Octokit;
}

const publishGithubPrInput = z.object({
  org: z.string().min(1).describe("GitHub organization or user login that owns the repo"),
  repo: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, "repo name must be GitHub-safe")
    .describe("Existing repository the PR targets"),
  baseBranch: z.string().min(1).default("main").describe("Branch the PR merges into"),
  branchName: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._/-]+$/, "branch name must be git-safe")
    .describe("New branch the rendered workspace is pushed to"),
  title: z.string().min(1).max(256).describe("Pull request title"),
  body: z.string().max(20_000).optional().describe("Pull request body"),
  commitMessage: z.string().min(1).default("Apply scaffold update").describe("Commit message"),
  sourceDir: z
    .string()
    .default(".")
    .describe("Workspace subdirectory to publish, defaults to the whole workspace"),
  tokenSecret: z
    .string()
    .default("GITHUB_TOKEN")
    .describe("Name of the platform secret holding the GitHub token"),
});

type PublishGithubPrInput = z.infer<typeof publishGithubPrInput>;

export interface PublishGithubPrOutput {
  prUrl: string;
  prNumber: number;
  branch: string;
  base: string;
  commitSha: string;
  fileCount: number;
}

const CLONE_DIR = "_pr_checkout";
const EXCLUDED_ROOTS = new Set([".git", "_repo", CLONE_DIR]);

async function copyWorkspaceInto(sourceRoot: string, targetRoot: string): Promise<number> {
  let copied = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(sourceRoot, abs);
      if (EXCLUDED_ROOTS.has(rel.split(/[\\/]/)[0]!)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const dest = join(targetRoot, rel);
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
        copied++;
      }
    }
  }
  await walk(sourceRoot);
  return copied;
}

export const publishGithubPrAction: Action<PublishGithubPrInput, PublishGithubPrOutput> = {
  id: "publish:github:pr",
  description: "Push the rendered workspace as a branch on an existing repo and open a PR.",
  schema: publishGithubPrInput,
  capabilities: ["network:external", "repo:private", "secrets:read:GITHUB_TOKEN"],
  // A pushed branch and an open PR are not auto-rolled back.
  irreversible: true,
  async match(_input, _ctx: ReadCtx) {
    return "absent";
  },
  async diff(input) {
    return [
      {
        kind: "github.openPr",
        repo: `${input.org}/${input.repo}`,
        branch: input.branchName,
        base: input.baseBranch,
        title: input.title,
      },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    const token = ctx.secrets.read(input.tokenSecret);

    if (ctx.dryRun) {
      ctx.logger.info(
        `[dry-run] publish:github:pr would push ${input.branchName} to ${input.org}/${input.repo} and open a PR against ${input.baseBranch}`,
      );
      return {
        output: {
          prUrl: `https://github.com/${input.org}/${input.repo}/pulls`,
          prNumber: 0,
          branch: input.branchName,
          base: input.baseBranch,
          commitSha: "dry-run",
          fileCount: 0,
        },
        compensation: { kind: "noop", reason: "dry run" },
      };
    }

    const remoteUrl = `https://github.com/${input.org}/${input.repo}.git`;
    const authedUrl = remoteUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
    const checkoutPath = join(ctx.workspacePath, CLONE_DIR);

    const git: SimpleGit = simpleGit();
    await git.clone(authedUrl, checkoutPath, [
      "--depth",
      "1",
      "--branch",
      input.baseBranch,
      "--single-branch",
    ]);
    const repoGit: SimpleGit = simpleGit(checkoutPath);
    await repoGit.addConfig("user.email", `${ctx.actor.userId}@scaffolder.platform`);
    await repoGit.addConfig("user.name", "Scaffolder");
    await repoGit.checkoutLocalBranch(input.branchName);

    const sourceRoot = join(ctx.workspacePath, input.sourceDir);
    const fileCount = await copyWorkspaceInto(sourceRoot, checkoutPath);
    if (fileCount === 0) {
      throw new Error("publish:github:pr: workspace produced no files to publish");
    }

    await repoGit.add(".");
    const status = await repoGit.status();
    if (status.files.length === 0) {
      throw new Error("publish:github:pr: rendered output is identical to the base branch");
    }
    const commit = await repoGit.commit(input.commitMessage);
    await repoGit.push(["-u", "origin", input.branchName]);
    ctx.logger.info(
      `publish:github:pr pushed ${fileCount} files to ${input.org}/${input.repo}#${input.branchName}`,
    );

    const Octokit = await loadOctokit();
    const octo = new Octokit({ auth: token });
    const { data: pr } = await octo.rest.pulls.create({
      owner: input.org,
      repo: input.repo,
      head: input.branchName,
      base: input.baseBranch,
      title: input.title,
      body: input.body,
    });
    ctx.logger.info(`publish:github:pr opened ${pr.html_url}`);

    return {
      output: {
        prUrl: pr.html_url,
        prNumber: pr.number,
        branch: input.branchName,
        base: input.baseBranch,
        commitSha: commit.commit,
        fileCount,
      },
      compensation: {
        kind: "noop",
        reason: `irreversible: branch ${input.branchName} and PR #${pr.number} on ${input.org}/${input.repo} require manual cleanup`,
      },
    };
  },
};

export { publishGithubPrInput };
