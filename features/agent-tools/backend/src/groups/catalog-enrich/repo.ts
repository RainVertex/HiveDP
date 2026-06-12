import { parseGithubUrl } from "@feature/scaffolder-backend/contract";
import { isOrgVisible } from "@feature/catalog-backend/contract";
import { getEntityRepoFields } from "./queries";

// Resolves an entity to its GitHub repo coordinates and installation, or a structured error the model/worker can act on.
export type EntityRepo = { owner: string; repo: string; installationId: number };
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
