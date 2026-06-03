import { projectsDb, ProjectRole } from "@internal/db";
import { createDefaultBuckets } from "./seed";

export interface ProvisionResult {
  created: number;
  updated: number;
  archived: number;
}

function rolePower(role: ProjectRole): number {
  return role === "ADMIN" ? 2 : role === "WRITE" ? 1 : 0;
}

// GitHub repo permission to project role: admin/maintain administer the repo,
// push can write, triage/pull are read-only.
function permissionToRole(permission: string): ProjectRole {
  if (permission === "admin" || permission === "maintain") return "ADMIN";
  if (permission === "push") return "WRITE";
  return "READ";
}

async function getInstallerUserId(installationId: number): Promise<string | null> {
  const integration = await projectsDb.integration.findFirst({
    where: {
      kind: "github",
      config: { path: ["installationId"], equals: installationId },
    },
    select: { config: true },
  });
  if (!integration) return null;
  const config = integration.config as { installerUserId?: unknown } | null;
  return typeof config?.installerUserId === "string" ? config.installerUserId : null;
}

export async function reconcileMembers(
  projectId: string,
  entityId: string,
  installationId: number,
): Promise<void> {
  const owners = await projectsDb.catalogEntityOwner.findMany({
    where: { entityId },
    select: {
      team: {
        select: {
          memberships: { select: { userId: true, role: true } },
        },
      },
    },
  });

  const target = new Map<string, ProjectRole>();
  const bump = (userId: string, role: ProjectRole) => {
    const existing = target.get(userId);
    if (!existing || rolePower(role) > rolePower(existing)) target.set(userId, role);
  };

  // Curated owners (catalog-info.yaml / manual): team membership role drives access.
  for (const o of owners) {
    for (const m of o.team.memberships) {
      bump(m.userId, m.role === "lead" ? "ADMIN" : "WRITE");
    }
  }

  // GitHub team-repo grants: the granted repo permission drives access for the whole team.
  const grants = await projectsDb.catalogEntityTeamGrant.findMany({
    where: { entityId },
    select: {
      permission: true,
      team: { select: { memberships: { select: { userId: true } } } },
    },
  });
  for (const g of grants) {
    const role = permissionToRole(g.permission);
    for (const m of g.team.memberships) bump(m.userId, role);
  }

  if (target.size === 0) {
    const installer = await getInstallerUserId(installationId);
    if (installer) target.set(installer, "ADMIN");
  }

  const existing = await projectsDb.projectMember.findMany({
    where: { projectId },
    select: { userId: true, role: true },
  });
  const existingMap = new Map(existing.map((e) => [e.userId, e.role]));

  await projectsDb.$transaction(async (tx) => {
    for (const [userId, role] of target) {
      if (existingMap.get(userId) !== role) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId } },
          create: { projectId, userId, role },
          update: { role },
        });
      }
    }
    for (const [userId] of existingMap) {
      if (!target.has(userId)) {
        await tx.projectMember.delete({
          where: { projectId_userId: { projectId, userId } },
        });
      }
    }
  });
}

export interface ProvisionForEntityResult {
  projectId: string;
  created: boolean;
}

export async function provisionProjectForEntity(
  entityId: string,
  installationId: number,
): Promise<ProvisionForEntityResult | null> {
  const entity = await projectsDb.catalogEntity.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      name: true,
      description: true,
      staleSince: true,
      installationId: true,
      project: { select: { id: true } },
    },
  });
  if (!entity) return null;

  const effectiveInstallationId = entity.installationId ?? installationId;
  const archived = entity.staleSince !== null;

  let projectId: string;
  let created = false;

  if (entity.project) {
    projectId = entity.project.id;
    await projectsDb.project.update({
      where: { id: projectId },
      data: {
        title: entity.name,
        description: entity.description,
        installationId: effectiveInstallationId,
        isArchived: archived,
      },
    });
  } else {
    projectId = await projectsDb.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          title: entity.name,
          description: entity.description,
          isArchived: archived,
          catalogEntityId: entity.id,
          installationId: effectiveInstallationId,
        },
        select: { id: true },
      });
      await createDefaultBuckets(tx, p.id);
      return p.id;
    });
    created = true;
  }

  await reconcileMembers(projectId, entity.id, effectiveInstallationId);
  return { projectId, created };
}

export async function provisionProjectsForInstallation(
  installationId: number,
  _source: "install" | "bulk" | "manual" | "boot" | "webhook",
): Promise<ProvisionResult> {
  const entities = await projectsDb.catalogEntity.findMany({
    where: { installationId },
    select: {
      id: true,
      staleSince: true,
      project: { select: { id: true, isArchived: true } },
    },
  });

  let created = 0;
  let updated = 0;
  let archived = 0;

  for (const e of entities) {
    if (e.staleSince) {
      if (e.project && !e.project.isArchived) {
        await projectsDb.project.update({
          where: { id: e.project.id },
          data: { isArchived: true },
        });
        archived++;
      }
      continue;
    }
    const result = await provisionProjectForEntity(e.id, installationId);
    if (!result) continue;
    if (result.created) created++;
    else updated++;
  }

  return { created, updated, archived };
}

export async function reconcileProjectMembersForInstallation(
  installationId: number,
): Promise<{ affectedProjects: number }> {
  const projects = await projectsDb.project.findMany({
    where: { installationId, catalogEntityId: { not: null } },
    select: { id: true, catalogEntityId: true },
  });
  for (const p of projects) {
    if (!p.catalogEntityId) continue;
    await reconcileMembers(p.id, p.catalogEntityId, installationId);
  }
  return { affectedProjects: projects.length };
}

export async function archiveProjectByGithubRepoId(githubRepoId: number): Promise<void> {
  const entity = await projectsDb.catalogEntity.findUnique({
    where: { githubRepoId },
    select: { project: { select: { id: true } } },
  });
  if (!entity?.project) return;
  await projectsDb.project.update({
    where: { id: entity.project.id },
    data: { isArchived: true },
  });
}

export async function unarchiveProjectByGithubRepoId(githubRepoId: number): Promise<void> {
  const entity = await projectsDb.catalogEntity.findUnique({
    where: { githubRepoId },
    select: { project: { select: { id: true } } },
  });
  if (!entity?.project) return;
  await projectsDb.project.update({
    where: { id: entity.project.id },
    data: { isArchived: false },
  });
}
