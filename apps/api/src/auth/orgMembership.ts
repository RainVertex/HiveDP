// Reconciles a user's UserOrgMembership rows against the GitHub orgs just confirmed at sign-in.
import { prisma } from "@internal/db";

// Drops rows for orgs no longer active and refreshes lastVerifiedAt for current ones.
export async function syncUserOrgMemberships(
  userId: string,
  activeLogins: string[],
): Promise<void> {
  await prisma.userOrgMembership.deleteMany({
    where: { userId, accountLogin: { notIn: activeLogins } },
  });

  if (activeLogins.length === 0) return;

  const now = new Date();
  await Promise.all(
    activeLogins.map((accountLogin) =>
      prisma.userOrgMembership.upsert({
        where: { userId_accountLogin: { userId, accountLogin } },
        update: { lastVerifiedAt: now },
        create: { userId, accountLogin, lastVerifiedAt: now },
      }),
    ),
  );
}
