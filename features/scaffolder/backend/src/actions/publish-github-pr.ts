import { join } from "node:path";
import { z } from "zod";
import { octokitForLogin } from "@feature/integrations-backend/contract";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";
import { buildTreeFromWorkspace } from "./github-commit";

// publish:github:pr action: commits the rendered workspace as a branch on an existing repo (as the
// App bot, via the Git Data API) and opens a PR.

const publishGithubPrInput = z.object({
  org: z.string().min(1).describe("GitHub organization that owns the repo"),
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

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export const publishGithubPrAction: Action<PublishGithubPrInput, PublishGithubPrOutput> = {
  id: "publish:github:pr",
  description: "Commit the rendered workspace as a branch on an existing repo and open a PR.",
  schema: publishGithubPrInput,
  capabilities: ["network:external", "repo:private"],
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

    const octo = await octokitForLogin(input.org);
    if (!octo) {
      throw new Error(
        `publish:github:pr: the GitHub App is not installed on "${input.org}". Install it on that organization (Administration + Contents write) before scaffolding.`,
      );
    }

    const repoMeta = await octo.rest.repos.get({ owner: input.org, repo: input.repo });
    if (repoMeta.data.archived) {
      throw new Error(`publish:github:pr: ${input.org}/${input.repo} is archived`);
    }

    const baseRef = await octo.rest.git.getRef({
      owner: input.org,
      repo: input.repo,
      ref: `heads/${input.baseBranch}`,
    });
    const baseSha = baseRef.data.object.sha;
    const baseCommit = await octo.rest.git.getCommit({
      owner: input.org,
      repo: input.repo,
      commit_sha: baseSha,
    });

    const sourceRoot = join(ctx.workspacePath, input.sourceDir);
    const { treeSha, fileCount } = await buildTreeFromWorkspace({
      octo,
      owner: input.org,
      repo: input.repo,
      dir: sourceRoot,
      baseTreeSha: baseCommit.data.tree.sha,
    });
    if (fileCount === 0) {
      throw new Error("publish:github:pr: workspace produced no files to publish");
    }
    if (treeSha === baseCommit.data.tree.sha) {
      throw new Error("publish:github:pr: rendered output is identical to the base branch");
    }

    const commit = await octo.rest.git.createCommit({
      owner: input.org,
      repo: input.repo,
      message: input.commitMessage,
      tree: treeSha,
      parents: [baseSha],
    });

    // Idempotent on a stable branch: re-runs move the branch to the new commit instead of failing.
    try {
      await octo.rest.git.createRef({
        owner: input.org,
        repo: input.repo,
        ref: `refs/heads/${input.branchName}`,
        sha: commit.data.sha,
      });
    } catch (err) {
      if (statusOf(err) !== 422) throw err;
      await octo.rest.git.updateRef({
        owner: input.org,
        repo: input.repo,
        ref: `heads/${input.branchName}`,
        sha: commit.data.sha,
        force: true,
      });
    }
    ctx.logger.info(
      `publish:github:pr committed ${fileCount} files to ${input.org}/${input.repo}#${input.branchName}`,
    );

    const open = await octo.rest.pulls.list({
      owner: input.org,
      repo: input.repo,
      head: `${input.org}:${input.branchName}`,
      state: "open",
    });
    let prUrl: string;
    let prNumber: number;
    const existing = open.data[0];
    if (existing) {
      prUrl = existing.html_url;
      prNumber = existing.number;
    } else {
      const created = await octo.rest.pulls.create({
        owner: input.org,
        repo: input.repo,
        head: input.branchName,
        base: input.baseBranch,
        title: input.title,
        body: input.body,
      });
      prUrl = created.data.html_url;
      prNumber = created.data.number;
    }
    ctx.logger.info(`publish:github:pr ${existing ? "updated" : "opened"} ${prUrl}`);

    return {
      output: {
        prUrl,
        prNumber,
        branch: input.branchName,
        base: input.baseBranch,
        commitSha: commit.data.sha,
        fileCount,
      },
      compensation: {
        kind: "noop",
        reason: `irreversible: branch ${input.branchName} and PR #${prNumber} on ${input.org}/${input.repo} require manual cleanup`,
      },
    };
  },
};

export { publishGithubPrInput };
