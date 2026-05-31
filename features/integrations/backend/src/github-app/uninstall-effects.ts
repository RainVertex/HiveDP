// Disconnect side effects: revoke sessions and drop org memberships for users stranded by an uninstall.
import { prisma } from "@internal/db";

// user.status is left untouched on purpose: org membership is the authoritative gate, admins keep a separate disable lever.
export async function revokeStrandedUserSessions(accountLogin: string): Promise<{
  affectedUserIds: string[];
}> {
  if (!accountLogin) return { affectedUserIds: [] };

  const affected = await prisma.userOrgMembership.findMany({
    where: { accountLogin },
    select: { userId: true },
  });
  const affectedUserIds = Array.from(new Set(affected.map((r) => r.userId)));

  await prisma.userOrgMembership.deleteMany({ where: { accountLogin } });

  if (affectedUserIds.length === 0) return { affectedUserIds: [] };

  const remaining = await prisma.userOrgMembership.groupBy({
    by: ["userId"],
    where: { userId: { in: affectedUserIds } },
    _count: { userId: true },
  });
  const stillCovered = new Set(remaining.map((r) => r.userId));
  const stranded = affectedUserIds.filter((id) => !stillCovered.has(id));

  if (stranded.length === 0) return { affectedUserIds: [] };

  await prisma.session.deleteMany({ where: { userId: { in: stranded } } });

  return { affectedUserIds: stranded };
}
