import { prisma } from "@internal/db";
import type { ToolContext } from "@internal/llm-core";
import { octokitForInstallation } from "@feature/integrations-backend/contract";
import { parseGithubUrl } from "@feature/scaffolder-backend/contract";
import { getProjectRepoRef } from "@feature/projects-backend/contract";
import { resolveOrgScope, isOrgVisible } from "@feature/catalog-backend/contract";
import { getEntityRepoFields } from "./queries";

// Resolves a repo target to a ready GitHub client plus coordinates, or a structured error the model
// can relay. Every repo tool funnels through resolveRepoClient so the read engine is identical for
// the platform's own repo, a project's connected repo, and a catalog entity's repo.

export type RepoClient = {
  octo: Awaited<ReturnType<typeof octokitForInstallation>>;
  owner: string;
  repo: string;
  ref: string | null;
};

export type RepoClientResult = RepoClient | { error: string; code: string };

// The catalog tag that marks the platform's own entity. Stamped during catalog sync when an entity
// matches PLATFORM_REPO_URL (see features/catalog/backend/src/service.ts).
const PLATFORM_TAG = "platform";

async function clientFor(
  installationId: number,
  owner: string,
  repo: string,
): Promise<RepoClientResult> {
  try {
    const octo = await octokitForInstallation(installationId);
    return { octo, owner, repo, ref: null };
  } catch {
    // octokitForInstallation throws only when the GitHub App env is missing.
    return { error: "GitHub App is not configured.", code: "no_credentials" };
  }
}

// The platform's own repo, resolved purely from the catalog by the "platform" tag.
export async function resolveSelfRepoClient(): Promise<RepoClientResult> {
  const entity = await prisma.catalogEntity.findFirst({
    where: { tags: { has: PLATFORM_TAG } },
    select: { repoUrl: true, installationId: true },
  });
  if (!entity || !entity.repoUrl) {
    return {
      error:
        'The platform source repository is not configured. Set PLATFORM_REPO_URL and sync the catalog so its entity is tagged "platform".',
      code: "not_configured",
    };
  }
  const gh = parseGithubUrl(entity.repoUrl);
  if (!gh) return { error: `repoUrl is not a github URL: ${entity.repoUrl}`, code: "not_github" };
  if (entity.installationId == null) {
    return { error: `No GitHub App installation for ${gh.owner}.`, code: "no_credentials" };
  }
  return clientFor(entity.installationId, gh.owner, gh.repo);
}

// A project's connected repo, authorized by project membership (not catalog org-scope) since an
// assigned agent is granted project WRITE, but is not a member of the repo's GitHub org.
export async function resolveProjectRepoClient(
  ctx: ToolContext,
  projectId: string,
): Promise<RepoClientResult> {
  if (!ctx.userId) return { error: "Not authenticated", code: "forbidden" };
  const ref = await getProjectRepoRef({ userId: ctx.userId, projectId });
  if ("error" in ref) return { error: ref.error, code: "forbidden" };
  if (!ref.repoUrl) return { error: "Project has no connected repository", code: "no_repo" };
  const gh = parseGithubUrl(ref.repoUrl);
  if (!gh) return { error: `repoUrl is not a github URL: ${ref.repoUrl}`, code: "not_github" };
  if (ref.installationId == null) {
    return { error: "Project repo has no GitHub App installation", code: "no_installation" };
  }
  return clientFor(ref.installationId, gh.owner, gh.repo);
}

export type EntityRepo = { owner: string; repo: string; installationId: number };

// Resolves a catalog entity to its GitHub repo coordinates and installation, authorized by org-scope
// visibility. The PR write needs these raw coordinates (it goes through openOrUpdateFilePr, not the
// read engine), so this stays separate from resolveEntityRepoClient.
export async function loadEntityRepo(
  entityId: unknown,
  scope: string[] | null,
): Promise<EntityRepo | { error: string; code: string }> {
  if (typeof entityId !== "string" || !entityId)
    return { error: "entityId required", code: "bad_args" };
  const entity = await getEntityRepoFields(entityId);
  if (!entity) return { error: `Entity not found: ${entityId}`, code: "not_found" };
  if (!isOrgVisible(scope, entity.accountLogin))
    return { error: "Org membership required", code: "forbidden" };
  if (!entity.repoUrl) return { error: "Entity has no repoUrl", code: "no_repo" };
  const gh = parseGithubUrl(entity.repoUrl);
  if (!gh) return { error: `repoUrl is not a github URL: ${entity.repoUrl}`, code: "not_github" };
  if (entity.installationId == null) {
    return {
      error: "Entity has no GitHub App installation; cannot read or write the repo",
      code: "no_installation",
    };
  }
  return { owner: gh.owner, repo: gh.repo, installationId: entity.installationId };
}

// A catalog entity's repo as a read client, authorized by org-scope visibility.
export async function resolveEntityRepoClient(
  ctx: ToolContext,
  entityId: string,
): Promise<RepoClientResult> {
  const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
  const repo = await loadEntityRepo(entityId, scope);
  if ("error" in repo) return repo;
  return clientFor(repo.installationId, repo.owner, repo.repo);
}

// Single entry point for the repo read tools. Dispatches on the target kind, each branch enforcing
// its own authorization.
export async function resolveRepoClient(
  ctx: ToolContext,
  target: unknown,
): Promise<RepoClientResult> {
  if (!ctx.userId) return { error: "Not authenticated", code: "forbidden" };
  const t = (target ?? {}) as { kind?: string; projectId?: string; entityId?: string };
  switch (t.kind) {
    case "platform":
      return resolveSelfRepoClient();
    case "project":
      if (!t.projectId)
        return { error: "target.projectId required for kind 'project'", code: "bad_args" };
      return resolveProjectRepoClient(ctx, t.projectId);
    case "entity":
      if (!t.entityId)
        return { error: "target.entityId required for kind 'entity'", code: "bad_args" };
      return resolveEntityRepoClient(ctx, t.entityId);
    default:
      return { error: "target.kind must be platform, project or entity", code: "bad_args" };
  }
}
