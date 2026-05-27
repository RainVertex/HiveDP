import { prisma, encryptSecret, decryptSecret } from "@internal/db";

interface OAuthConfig {
  baseUrl: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  user_email: string;
}

export async function provisionUserTokens(
  integrationId: string,
  cfg: OAuthConfig,
): Promise<number> {
  if (!cfg.oauthClientId || !cfg.oauthClientSecret) return 0;

  const mappings = await prisma.planeUserMapping.findMany({
    where: { member: { workspace: { integrationId } } },
    select: {
      platformUserId: true,
      member: { select: { email: true } },
    },
  });
  if (mappings.length === 0) return 0;

  const existingTokens = await prisma.planeOAuthToken.findMany({
    where: { integrationId },
    select: { userId: true },
  });
  const hasToken = new Set(existingTokens.map((t) => t.userId));

  const needsToken = mappings.filter((m) => !hasToken.has(m.platformUserId));
  if (needsToken.length === 0) return 0;

  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const clientSecret = decryptSecret(cfg.oauthClientSecret);
  let created = 0;

  for (const mapping of needsToken) {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.oauthClientId,
        client_secret: clientSecret,
        user_email: mapping.member.email,
      });
      const res = await fetch(`${baseUrl}/auth/o/token/`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as TokenResponse;
      await prisma.planeOAuthToken.upsert({
        where: { userId_integrationId: { userId: mapping.platformUserId, integrationId } },
        create: {
          userId: mapping.platformUserId,
          integrationId,
          encryptedAccessToken: encryptSecret(data.access_token),
          encryptedRefreshToken: encryptSecret(data.refresh_token),
          planeUserId: data.user_id,
          planeEmail: data.user_email,
          expiresAt: new Date(Date.now() + data.expires_in * 1000),
        },
        update: {
          encryptedAccessToken: encryptSecret(data.access_token),
          encryptedRefreshToken: encryptSecret(data.refresh_token),
          planeUserId: data.user_id,
          planeEmail: data.user_email,
          expiresAt: new Date(Date.now() + data.expires_in * 1000),
        },
      });
      created++;
    } catch {
      // best effort per user
    }
  }
  return created;
}
