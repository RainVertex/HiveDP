// Builds the user and entity halves of the jq template context from the DB.
import { prisma } from "@internal/db";

export async function buildUserContext(userId: string): Promise<Record<string, unknown> | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, displayName: true, email: true, role: true },
  });
  if (!user) return null;
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, team: { deletedAt: null } },
    select: { team: { select: { id: true, slug: true, name: true } } },
  });
  return { ...user, teams: memberships.map((m) => m.team) };
}

export async function buildEntityContext(
  entityId: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!entityId) return null;
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      name: true,
      kind: true,
      description: true,
      lifecycle: true,
      repoUrl: true,
      tags: true,
      accountLogin: true,
    },
  });
  return entity ?? null;
}
