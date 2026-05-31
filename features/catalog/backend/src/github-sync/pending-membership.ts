// Lifecycle for pending GitHub team memberships (members without a matched platform User yet), converted on SSO sign-in or expired by TTL.
import { prisma } from "@internal/db";

export interface PendingResolutionResult {
  resolved: number;
  skippedExpired: number;
}

/** Drain non-expired pending rows into TeamMembership for a user who just signed in. */
export async function resolvePendingForUser(
  userId: string,
  githubId: string,
): Promise<PendingResolutionResult> {
  const now = new Date();
  const candidates = await prisma.pendingTeamMembership.findMany({
    where: { githubId },
    select: { id: true, teamId: true, role: true, expiresAt: true },
  });

  if (candidates.length === 0) {
    return { resolved: 0, skippedExpired: 0 };
  }

  const live = candidates.filter((c) => c.expiresAt > now);
  const expired = candidates.filter((c) => c.expiresAt <= now);

  let resolved = 0;
  if (live.length > 0) {
    await prisma.$transaction(async (tx) => {
      const inserted = await tx.teamMembership.createMany({
        data: live.map((c) => ({
          teamId: c.teamId,
          userId,
          role: c.role,
        })),
        skipDuplicates: true,
      });
      resolved = inserted.count;
      await tx.pendingTeamMembership.deleteMany({
        where: { id: { in: live.map((c) => c.id) } },
      });
    });
  }

  // Clean up expired rows for this githubId on the same pass.
  if (expired.length > 0) {
    await prisma.pendingTeamMembership.deleteMany({
      where: { id: { in: expired.map((c) => c.id) } },
    });
  }

  return { resolved, skippedExpired: expired.length };
}

/** Drop all pending rows past their expiresAt. */
export async function expirePendingMemberships(): Promise<{ deleted: number }> {
  const result = await prisma.pendingTeamMembership.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: result.count };
}
