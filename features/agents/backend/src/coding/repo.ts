import { installationGitToken } from "@feature/integrations-backend/contract";

// Repo coordinate resolution for the coding runtime. The project task handler already resolved and
// passed repoUrl + installationId (both non-secret, stored plaintext on the project), so here we only
// parse and validate them and mint the short-lived git token at run time (never in the stored input).

export interface ResolvedCodingRepo {
  owner: string;
  repo: string;
  installationId: number;
  repoUrl: string;
}

export function parseGithubRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function resolveCodingRepoCoords(repo: {
  repoUrl: string | null;
  installationId: number | null;
}): ResolvedCodingRepo | { error: string } {
  if (!repo.repoUrl) return { error: "Project has no connected repository." };
  if (repo.installationId == null) return { error: "Project repo has no GitHub App installation." };
  const gh = parseGithubRepoUrl(repo.repoUrl);
  if (!gh) return { error: `Connected repoUrl is not a GitHub URL: ${repo.repoUrl}` };
  return {
    owner: gh.owner,
    repo: gh.repo,
    installationId: repo.installationId,
    repoUrl: repo.repoUrl,
  };
}

export async function mintRepoGitToken(installationId: number): Promise<string> {
  return installationGitToken(installationId);
}
