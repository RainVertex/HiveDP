import { octokitForInstallation } from "@feature/integrations-backend/contract";

// Opens (or reuses) a draft PR for the branch the sandbox pushed, attributed to the App bot. Idempotent:
// a re-run on the same branch returns the existing open PR instead of erroring.

export interface OpenDraftPrInput {
  installationId: number;
  owner: string;
  repo: string;
  branch: string;
  title: string;
  body: string;
}

export interface OpenDraftPrResult {
  prUrl: string;
  prNumber: number;
}

export async function openDraftPr(input: OpenDraftPrInput): Promise<OpenDraftPrResult> {
  const octo = await octokitForInstallation(input.installationId);
  const meta = await octo.rest.repos.get({ owner: input.owner, repo: input.repo });
  const base = meta.data.default_branch;

  const open = await octo.rest.pulls.list({
    owner: input.owner,
    repo: input.repo,
    head: `${input.owner}:${input.branch}`,
    state: "open",
  });
  const existing = open.data[0];
  if (existing) return { prUrl: existing.html_url, prNumber: existing.number };

  const created = await octo.rest.pulls.create({
    owner: input.owner,
    repo: input.repo,
    head: input.branch,
    base,
    title: input.title,
    body: input.body,
    draft: true,
  });
  return { prUrl: created.data.html_url, prNumber: created.data.number };
}
