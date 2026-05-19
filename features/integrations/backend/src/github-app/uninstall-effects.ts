import { prisma } from "@internal/db";

// Side effects to run when a GitHub org's integration is disconnected,
// regardless of whether the trigger was an admin DELETE or the
// installation.deleted webhook. Find every user whose only remaining org
// coverage was this one, disable them, and kill their sessions so they're
// forced to re-authenticate. Admin users are exempt, they bypass the org
// check on sign-in anyway and shouldn't get locked out automatically.
export async function disableStrandedUsers(accountLogin: string): Promise<{
  disabledUserIds: string[];
}> {
  if (!accountLogin) return { disabledUserIds: [] };

  const affected = await prisma.userOrgMembership.findMany({
    where: { accountLogin },
    select: { userId: true },
  });
  const affectedUserIds = Array.from(new Set(affected.map((r) => r.userId)));

  await prisma.userOrgMembership.deleteMany({ where: { accountLogin } });

  if (affectedUserIds.length === 0) return { disabledUserIds: [] };

  const remaining = await prisma.userOrgMembership.groupBy({
    by: ["userId"],
    where: { userId: { in: affectedUserIds } },
    _count: { userId: true },
  });
  const stillCovered = new Set(remaining.map((r) => r.userId));
  const stranded = affectedUserIds.filter((id) => !stillCovered.has(id));

  if (stranded.length === 0) return { disabledUserIds: [] };

  await prisma.user.updateMany({
    where: { id: { in: stranded }, role: { not: "admin" } },
    data: { status: "disabled" },
  });
  await prisma.session.deleteMany({ where: { userId: { in: stranded } } });

  return { disabledUserIds: stranded };
}
