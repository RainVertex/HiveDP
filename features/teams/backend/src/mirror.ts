// GitHub team mirror helpers. createGithubTeam runs BEFORE platform writes; orphans are cleaned via bestEffortDeleteGithubTeam.
import { octokitForInstallation } from "@feature/integrations-backend/contract";

export class GithubMirrorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubMirrorError";
  }
}

export interface CreateGithubTeamInput {
  installationId: number;
  orgLogin: string;
  /** Platform slug, passed as `name` to GitHub since GitHub re-derives the slug from the name. */
  name: string;
  description: string | null;
}

export interface CreateGithubTeamResult {
  /** GitHub team node_id, stable across renames. what we stamp on Team.externalId. */
  nodeId: string;
  /** GitHub-assigned slug (may differ from input name's slugification). */
  githubSlug: string;
}

export async function createGithubTeam(
  input: CreateGithubTeamInput,
): Promise<CreateGithubTeamResult> {
  const octo = await octokitForInstallation(input.installationId);
  try {
    const res = await octo.rest.teams.create({
      org: input.orgLogin,
      name: input.name,
      description: input.description ?? undefined,
      privacy: "closed",
    });
    const data = res.data as { node_id?: string; slug?: string };
    if (!data.node_id || !data.slug) {
      throw new GithubMirrorError(
        502,
        "GitHub team-create returned an unexpected response (missing node_id or slug)",
      );
    }
    return { nodeId: data.node_id, githubSlug: data.slug };
  } catch (err) {
    if (err instanceof GithubMirrorError) throw err;
    const e = err as { status?: number; message?: string };
    const status = typeof e.status === "number" ? e.status : 502;
    const message = e.message ?? "Unknown GitHub error";
    throw new GithubMirrorError(status, message);
  }
}

export interface AddGithubTeamMemberInput {
  installationId: number;
  orgLogin: string;
  githubSlug: string;
  /** GitHub login of the user to add. */
  githubLogin: string;
  role: "maintainer" | "member";
}

export interface AddGithubTeamMemberResult {
  state: "active" | "pending";
}

export async function addGithubTeamMember(
  input: AddGithubTeamMemberInput,
): Promise<AddGithubTeamMemberResult> {
  const octo = await octokitForInstallation(input.installationId);
  try {
    const res = await octo.rest.teams.addOrUpdateMembershipForUserInOrg({
      org: input.orgLogin,
      team_slug: input.githubSlug,
      username: input.githubLogin,
      role: input.role,
    });
    const data = res.data as { state?: string };
    const state = data.state === "pending" ? "pending" : "active";
    return { state };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const status = typeof e.status === "number" ? e.status : 502;
    const message = e.message ?? "Unknown GitHub error";
    throw new GithubMirrorError(status, message);
  }
}

export async function addGithubTeamMaintainer(
  input: Omit<AddGithubTeamMemberInput, "role">,
): Promise<AddGithubTeamMemberResult> {
  return addGithubTeamMember({ ...input, role: "maintainer" });
}

// Orphan-recovery path when the platform-side tx fails after GitHub team-create succeeded.
export async function bestEffortDeleteGithubTeam(
  installationId: number,
  orgLogin: string,
  githubSlug: string,
): Promise<void> {
  try {
    const octo = await octokitForInstallation(installationId);
    await octo.rest.teams.deleteInOrg({ org: orgLogin, team_slug: githubSlug });
  } catch {
    // Intentional: orphan cleanup is best-effort.
  }
}
