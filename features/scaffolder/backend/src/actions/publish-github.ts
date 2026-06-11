import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import simpleGit, { type SimpleGit } from "simple-git";
import type { Octokit as OctokitClient } from "octokit";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";

// publish:github action: creates a GitHub repo and pushes the workspace as an irreversible initial commit.

// octokit v5 is ESM-only and breaks the CJS loader on static import, so defer it to apply().
async function loadOctokit(): Promise<typeof OctokitClient> {
  const mod = await import("octokit");
  return mod.Octokit;
}

const publishGithubInput = z.object({
  org: z.string().min(1).describe("GitHub organization or user login that will own the repo"),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, "repo name must be GitHub-safe")
    .describe("Name of the repository to create"),
  visibility: z.enum(["public", "private"]).default("private").describe("Repository visibility"),
  description: z.string().max(350).optional().describe("Repository description"),
  defaultBranch: z.string().default("main").describe("Branch the initial commit is pushed to"),
  tokenSecret: z
    .string()
    .default("GITHUB_TOKEN")
    .describe("Name of the platform secret holding the GitHub token"),
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

async function createRepo(
  octo: OctokitClient,
  input: PublishGithubInput,
): Promise<{ fullName: string; cloneUrl: string; repoId: number }> {
  // Try the org endpoint first; on 404 the org is actually a user login, so fall back.
  try {
    const { data } = await octo.rest.repos.createInOrg({
      org: input.org,
      name: input.name,
      private: input.visibility === "private",
      description: input.description,
      auto_init: false,
    });
    return { fullName: data.full_name, cloneUrl: data.clone_url, repoId: data.id };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
    const { data } = await octo.rest.repos.createForAuthenticatedUser({
      name: input.name,
      private: input.visibility === "private",
      description: input.description,
      auto_init: false,
    });
    return { fullName: data.full_name, cloneUrl: data.clone_url, repoId: data.id };
  }
}

async function pushInitialCommit(
  workspacePath: string,
  remoteUrl: string,
  defaultBranch: string,
  token: string,
  authoredBy: string,
): Promise<string> {
  // GitHub's recommended x-access-token form for fine-scoped tokens over HTTPS.
  const authedUrl = remoteUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
  const git: SimpleGit = simpleGit(workspacePath);
  await git.init();
  await git.addConfig("user.email", `${authoredBy}@scaffolder.platform`);
  await git.addConfig("user.name", "Scaffolder");
  await git.add(".");
  // --allow-empty so a misconfigured (zero-file) template still yields a real repo head.
  const commit = await git.commit("Initial scaffold", { "--allow-empty": null });
  await git.branch(["-M", defaultBranch]);
  await git.addRemote("origin", authedUrl);
  await git.push(["-u", "origin", defaultBranch]);
  return commit.commit;
}

export const publishGithubAction: Action<PublishGithubInput, PublishGithubOutput> = {
  id: "publish:github",
  description: "Create a GitHub repo and push the workspace as the initial commit.",
  schema: publishGithubInput,
  capabilities: ["network:external", "repo:public", "secrets:read:GITHUB_TOKEN"],
  irreversible: true,
  async match(_input, _ctx: ReadCtx) {
    // Without a token we cannot probe, so treat as absent; apply refuses if the repo exists.
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
    const token = ctx.secrets.read(input.tokenSecret);
    if (token.length >= 4) {
      ctx.logger.info(`publish:github authenticating as token "${token.slice(0, 4)}***"`);
    }

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

    const Octokit = await loadOctokit();
    const octo = new Octokit({ auth: token });
    if (await repoExists(octo, input.org, input.name)) {
      throw new Error(
        `publish:github: ${input.org}/${input.name} already exists; refusing to overwrite`,
      );
    }
    const { fullName, cloneUrl, repoId } = await createRepo(octo, input);
    ctx.logger.info(`publish:github created ${fullName}`);

    // Count only for the audit trail; never log file contents.
    const fileCount = await countWorkspaceFiles(ctx.workspacePath);

    const sha = await pushInitialCommit(
      ctx.workspacePath,
      cloneUrl,
      input.defaultBranch,
      token,
      ctx.actor.userId,
    );
    ctx.logger.info(`publish:github pushed ${fileCount} files to ${input.defaultBranch}`);

    return {
      output: {
        remoteUrl: cloneUrl,
        defaultBranch: input.defaultBranch,
        repoVisibility: input.visibility,
        repoFullName: fullName,
        repoId,
        initialCommitSha: sha,
      },
      // Irreversible: a public push cannot be auto-rolled-back, so cleanup is left to the operator.
      compensation: {
        kind: "noop",
        reason: `irreversible: github repo ${fullName} created and pushed; manual cleanup required if rollback is needed`,
      },
    };
  },
};

async function countWorkspaceFiles(root: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) count++;
    }
  }
  try {
    await walk(root);
  } catch {
    // empty workspace
  }
  return count;
}

export { publishGithubInput };
