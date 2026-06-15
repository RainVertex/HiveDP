import { z } from "zod";
import type { Octokit as OctokitClient } from "octokit";
import { octokitForLogin } from "@feature/integrations-backend/contract";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";
import { buildTreeFromWorkspace } from "./github-commit";

// publish:github action: creates a GitHub repo and pushes the workspace as the App bot's initial commit.

const publishGithubInput = z.object({
  org: z.string().min(1).describe("GitHub organization that will own the repo"),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, "repo name must be GitHub-safe")
    .describe("Name of the repository to create"),
  visibility: z.enum(["public", "private"]).default("private").describe("Repository visibility"),
  description: z.string().max(350).optional().describe("Repository description"),
  defaultBranch: z.string().default("main").describe("Branch the initial commit is pushed to"),
});

type PublishGithubInput = z.infer<typeof publishGithubInput>;

export interface PublishGithubOutput {
  remoteUrl: string;
  defaultBranch: string;
  repoVisibility: "public" | "private";
  repoFullName: string;
  // GitHub's stable numeric repo id, feed it to catalog:register so discovery converges.
  repoId: number;
  initialCommitSha: string;
}

async function repoExists(octo: OctokitClient, org: string, name: string): Promise<boolean> {
  try {
    await octo.rest.repos.get({ owner: org, repo: name });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return false;
    throw err;
  }
}

export const publishGithubAction: Action<PublishGithubInput, PublishGithubOutput> = {
  id: "publish:github",
  description: "Create a GitHub repo and push the workspace as the App bot's initial commit.",
  schema: publishGithubInput,
  capabilities: ["network:external", "repo:public"],
  irreversible: true,
  async match(_input, _ctx: ReadCtx) {
    // Without an installation we cannot probe, so treat as absent; apply refuses if the repo exists.
    return "absent";
  },
  async diff(input) {
    return [
      {
        kind: "github.createRepo",
        org: input.org,
        name: input.name,
        visibility: input.visibility,
      },
      {
        kind: "github.push",
        remoteUrl: `https://github.com/${input.org}/${input.name}.git`,
        branch: input.defaultBranch,
        // Real file count is computed at apply time; this plan-time value is illustrative.
        fileCount: 0,
      },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    if (ctx.dryRun) {
      ctx.logger.info(
        `[dry-run] publish:github would create ${input.org}/${input.name} and push ${input.defaultBranch}`,
      );
      return {
        output: {
          remoteUrl: `https://github.com/${input.org}/${input.name}.git`,
          defaultBranch: input.defaultBranch,
          repoVisibility: input.visibility,
          repoFullName: `${input.org}/${input.name}`,
          repoId: 0,
          initialCommitSha: "dry-run",
        },
        compensation: { kind: "noop", reason: "dry run" },
      };
    }

    const octo = await octokitForLogin(input.org);
    if (!octo) {
      throw new Error(
        `publish:github: the GitHub App is not installed on "${input.org}". Install it on that organization (Administration + Contents write) before scaffolding.`,
      );
    }

    if (await repoExists(octo, input.org, input.name)) {
      throw new Error(
        `publish:github: ${input.org}/${input.name} already exists; refusing to overwrite`,
      );
    }

    const { data: repo } = await octo.rest.repos.createInOrg({
      org: input.org,
      name: input.name,
      private: input.visibility === "private",
      description: input.description,
      auto_init: false,
    });
    ctx.logger.info(`publish:github created ${repo.full_name}`);

    const { treeSha, fileCount } = await buildTreeFromWorkspace({
      octo,
      owner: input.org,
      repo: input.name,
      dir: ctx.workspacePath,
    });
    if (fileCount === 0) {
      throw new Error("publish:github: template rendered no files to commit");
    }

    const commit = await octo.rest.git.createCommit({
      owner: input.org,
      repo: input.name,
      message: "Initial scaffold",
      tree: treeSha,
      parents: [],
    });
    await octo.rest.git.createRef({
      owner: input.org,
      repo: input.name,
      ref: `refs/heads/${input.defaultBranch}`,
      sha: commit.data.sha,
    });
    if (input.defaultBranch !== repo.default_branch) {
      await octo.rest.repos.update({
        owner: input.org,
        repo: input.name,
        default_branch: input.defaultBranch,
      });
    }
    ctx.logger.info(`publish:github pushed ${fileCount} files to ${input.defaultBranch}`);

    return {
      output: {
        remoteUrl: repo.clone_url,
        defaultBranch: input.defaultBranch,
        repoVisibility: input.visibility,
        repoFullName: repo.full_name,
        repoId: repo.id,
        initialCommitSha: commit.data.sha,
      },
      // Irreversible: a public push cannot be auto-rolled-back, so cleanup is left to the operator.
      compensation: {
        kind: "noop",
        reason: `irreversible: github repo ${repo.full_name} created and pushed; manual cleanup required if rollback is needed`,
      },
    };
  },
};

export { publishGithubInput };
