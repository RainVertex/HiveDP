import { prisma } from "@internal/db";

// Reconcile a user's UserOrgMembership rows with the set of GitHub org logins
// GitHub just confirmed they are an active member of. Rows for logins they no
// longer belong to are removed; current logins get their lastVerifiedAt
// refreshed. Called from the OAuth callback after a successful org check.
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
