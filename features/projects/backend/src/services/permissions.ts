import { projectsDb, ProjectRole } from "@internal/db";

export type PermissionLevel = "read" | "write" | "admin";

export interface AccessContext {
  project: { id: string; creatorUserId: string | null };
  maxPermission: 0 | 1 | 2;
}

export function roleToNumeric(role: ProjectRole): 0 | 1 | 2 {
  switch (role) {
    case "READ":
      return 0;
    case "WRITE":
      return 1;
    case "ADMIN":
      return 2;
  }
}

export function numericToRole(value: number): ProjectRole {
  if (value <= 0) return "READ";
  if (value === 1) return "WRITE";
  return "ADMIN";
}

export async function resolveAccess(
  userId: string,
  projectId: string,
): Promise<AccessContext | null> {
  const [project, user] = await Promise.all([
    projectsDb.project.findUnique({
      where: { id: projectId },
      select: { id: true, creatorUserId: true },
    }),
    projectsDb.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!project) return null;

  // Platform admins and the project creator always have full (ADMIN) access.
  if (user?.role === "admin" || project.creatorUserId === userId) {
    return { project, maxPermission: 2 };
  }

  const member = await projectsDb.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (!member) return null;

  return { project, maxPermission: roleToNumeric(member.role) };
}

export function meetsLevel(access: AccessContext, level: PermissionLevel): boolean {
  switch (level) {
    case "read":
      return access.maxPermission >= 0;
    case "write":
      return access.maxPermission >= 1;
    case "admin":
      return access.maxPermission >= 2;
  }
}
