import { projectsDb } from "@internal/db";
import { resolveAccess } from "./permissions";

// Resolves a project's connected repository coordinates for the project repo agent tools. Authorization
// is project membership (READ): an assigned agent is granted project WRITE, so it may read the repo even
// though it is not a member of the repo's GitHub org. The link itself lives on the project's catalog
// entity (repoUrl) plus the project's installationId.

type ProjectRepoRef = { repoUrl: string | null; installationId: number | null } | { error: string };

export async function getProjectRepoRef(input: {
  userId: string;
  projectId: string;
}): Promise<ProjectRepoRef> {
  const access = await resolveAccess(input.userId, input.projectId);
  if (!access) return { error: "Project not found" };

  const project = await projectsDb.project.findUnique({
    where: { id: input.projectId },
    select: { installationId: true, catalogEntity: { select: { repoUrl: true } } },
  });
  if (!project) return { error: "Project not found" };

  return {
    repoUrl: project.catalogEntity?.repoUrl ?? null,
    installationId: project.installationId,
  };
}
