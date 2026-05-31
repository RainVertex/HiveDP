// GitHub OAuth helpers: authorize URL, token exchange, user/org lookups, and org-denial IP throttling.
import { prisma } from "@internal/db";
import { loadEnv } from "../config/env";
import { logger } from "../logger/logger";

export interface GithubUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  primaryEmail: string;
}

export function buildAuthorizeUrl(state: string): string {
  const env = loadEnv();
  const params = new URLSearchParams({
    client_id: env.github.clientId,
    redirect_uri: env.github.authCallbackUrl,
    scope: "read:org user:email",
    state,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const env = loadEnv();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: env.github.clientId,
      client_secret: env.github.clientSecret,
      code,
      redirect_uri: env.github.authCallbackUrl,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) {
    throw new Error(`GitHub token exchange error: ${body.error ?? "no token"}`);
  }
  return body.access_token;
}

export async function fetchGithubUser(token: string): Promise<GithubUser> {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "mep-platform",
  };

  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
  const user = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
  };

  let primaryEmail = user.email;
  if (!primaryEmail) {
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (!emailsRes.ok) throw new Error(`GitHub /user/emails failed: ${emailsRes.status}`);
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const pick = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    primaryEmail = pick?.email ?? null;
  }

  if (!primaryEmail) {
    throw new Error("No verified email on GitHub account");
  }

  return {
    id: String(user.id),
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    primaryEmail: primaryEmail.toLowerCase(),
  };
}

async function fetchActiveMembership(token: string, org: string): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "mep-platform",
      },
    },
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub org membership check failed for ${org}: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { state?: string };
  return body.state === "active";
}

export async function verifyAnyOrgMembership(token: string): Promise<string[]> {
  const integrations = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { config: true },
  });
  const orgLogins = integrations
    .map((i) => {
      const cfg = i.config as { accountLogin?: unknown } | null;
      return cfg && typeof cfg.accountLogin === "string" ? cfg.accountLogin : null;
    })
    .filter((s): s is string => s !== null && s.length > 0);

  if (orgLogins.length === 0) return [];

  const results = await Promise.allSettled(
    orgLogins.map(async (org) => ({ org, active: await fetchActiveMembership(token, org) })),
  );

  const activeLogins: string[] = [];
  let anyFulfilled = false;
  for (const r of results) {
    if (r.status === "fulfilled") {
      anyFulfilled = true;
      if (r.value.active) activeLogins.push(r.value.org);
    } else {
      logger.warn({ err: r.reason }, "GitHub org membership check error");
    }
  }

  if (activeLogins.length > 0) return activeLogins;
  if (!anyFulfilled) {
    // Total API failure is treated as "not a member" so the user gets the friendly screen, not a stack trace.
    logger.error("All GitHub org membership checks failed; denying sign-in");
  }
  return [];
}

const ORG_DENIAL_WINDOW_MS = 15 * 60 * 1000;
const ORG_DENIAL_THRESHOLD = 5;
const orgDenials = new Map<string, { count: number; blockedUntil: number }>();

export function isIpBlockedForOrgDenials(ip: string): boolean {
  const entry = orgDenials.get(ip);
  if (!entry) return false;
  if (entry.blockedUntil > Date.now()) return true;
  if (entry.blockedUntil !== 0 && entry.blockedUntil <= Date.now()) {
    orgDenials.delete(ip);
  }
  return false;
}

export function recordOrgDenial(ip: string): void {
  const entry = orgDenials.get(ip) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= ORG_DENIAL_THRESHOLD) {
    entry.blockedUntil = Date.now() + ORG_DENIAL_WINDOW_MS;
  }
  orgDenials.set(ip, entry);
}

export function clearOrgDenial(ip: string): void {
  orgDenials.delete(ip);
}
