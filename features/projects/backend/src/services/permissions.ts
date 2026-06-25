import { projectsDb, ProjectRole } from "@internal/db";

export type PermissionLevel = "read" | "write" | "admin";

// Roles mirror GitHub repo permissions (READ < TRIAGE < WRITE < MAINTAIN < ADMIN). The app has three
// capability gates, so TRIAGE reads, WRITE edits, and MAINTAIN + ADMIN both administer (see meetsLevel).
export interface AccessContext {
  project: { id: string; creatorUserId: string | null };
  maxPermission: 0 | 1 | 2 | 3 | 4;
}

export function roleToNumeric(role: ProjectRole): 0 | 1 | 2 | 3 | 4 {
  switch (role) {
    case "READ":
      return 0;
    case "TRIAGE":
      return 1;
    case "WRITE":
      return 2;
    case "MAINTAIN":
      return 3;
    case "ADMIN":
      return 4;
  }
}

export function numericToRole(value: number): ProjectRole {
  if (value <= 0) return "READ";
  if (value === 1) return "TRIAGE";
  if (value === 2) return "WRITE";
  if (value === 3) return "MAINTAIN";
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
    return { project, maxPermission: 4 };
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
      return access.maxPermission >= 2; // WRITE, MAINTAIN, ADMIN (TRIAGE is read-only)
    case "admin":
      return access.maxPermission >= 3; // MAINTAIN and ADMIN administer
  }
}

// Project ids the user can read: every project for a platform admin, else the ones they belong to or
// created. Used by cross-project reads (search, my-tasks) that cannot lean on a single resolveAccess.
export async function visibleProjectIds(userId: string): Promise<string[]> {
  const user = await projectsDb.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "admin") {
    const all = await projectsDb.project.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }
  const [members, created] = await Promise.all([
    projectsDb.projectMember.findMany({ where: { userId }, select: { projectId: true } }),
    projectsDb.project.findMany({ where: { creatorUserId: userId }, select: { id: true } }),
  ]);
  return [...new Set([...members.map((m) => m.projectId), ...created.map((c) => c.id)])];
}
