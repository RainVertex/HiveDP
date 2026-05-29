type CodeIssuer = (userId: string) => Promise<string>;

let issueCode: CodeIssuer | null = null;

const VIKUNJA_API_URL = process.env.VIKUNJA_API_URL || "http://localhost:3456/api/v1";

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

// Per-user in-flight promise so parallel callers share one OIDC exchange.
const inflightFetches = new Map<string, Promise<string>>();

// 55-minute TTL so we refresh before the typical 60-minute JWT expiry
const TOKEN_TTL_MS = 55 * 60 * 1000;

export function configureAuth(opts: { issueCode: CodeIssuer }): void {
  issueCode = opts.issueCode;
}

export function invalidateVikunjaToken(platformUserId: string): void {
  tokenCache.delete(platformUserId);
}

async function fetchFreshToken(platformUserId: string): Promise<string> {
  if (!issueCode) {
    throw new Error("Vikunja auth not configured, call configureAuth() at boot");
  }

  const code = await issueCode(platformUserId);
  const vikunjaBase = VIKUNJA_API_URL.replace(/\/api\/v1\/?$/, "");
  const redirectUrl = `${vikunjaBase}/auth/openid/platform`;
  const res = await fetch(`${VIKUNJA_API_URL}/auth/openid/platform/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_url: redirectUrl, scope: "openid profile email" }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to obtain Vikunja JWT: ${res.status} ${body}`);
  }

  const data = JSON.parse(body) as { token?: string };
  if (!data.token) {
    throw new Error(`Vikunja callback returned no token: ${body}`);
  }
  tokenCache.set(platformUserId, {
    token: data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return data.token;
}

export async function getVikunjaToken(platformUserId: string): Promise<string> {
  const cached = tokenCache.get(platformUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const existing = inflightFetches.get(platformUserId);
  if (existing) return existing;

  const promise = fetchFreshToken(platformUserId).finally(() => {
    inflightFetches.delete(platformUserId);
  });
  inflightFetches.set(platformUserId, promise);
  return promise;
}
