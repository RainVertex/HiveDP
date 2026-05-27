import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "@internal/db";
import type { User } from "@internal/db";
import type { CurrentUser } from "@internal/shared-types";
import { resolvePendingForUser } from "@feature/catalog-backend";
import { logger } from "../logger/logger";
import { loadEnv } from "../config/env";
import {
  authCallbackLimiter,
  authInitiateLimiter,
  authLogoutLimiter,
  authMeLimiter,
} from "../middleware/rateLimit";
import {
  buildAuthorizeUrl,
  clearOrgDenial,
  exchangeCodeForToken,
  fetchGithubUser,
  isIpBlockedForOrgDenials,
  recordOrgDenial,
  verifyAnyOrgMembership,
} from "./githubOAuth";
import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  revokeSession,
  setSessionCookie,
} from "./session";
import { syncUserOrgMemberships } from "./orgMembership";
import { requireAuth } from "../middleware/requireAuth";
import { recordSystemAudit } from "../audit/audit";

const STATE_COOKIE = "mep_oauth_state";

export const authRouter = Router();

function toCurrentUser(u: User): CurrentUser {
  return {
    id: u.id,
    githubLogin: u.githubLogin,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status as CurrentUser["status"],
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

authRouter.get("/github", authInitiateLimiter, (req, res) => {
  const env = loadEnv();
  const state = randomBytes(16).toString("base64url");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/auth",
    maxAge: 10 * 60 * 1000,
    signed: true,
  });
  res.redirect(buildAuthorizeUrl(state));
});

authRouter.get("/github/callback", authCallbackLimiter, async (req, res, next) => {
  try {
    const env = loadEnv();
    const ip = req.ip ?? "unknown";

    if (isIpBlockedForOrgDenials(ip)) {
      res.status(429).json({ error: "Too many failed sign-in attempts. Try again later." });
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const expectedState = req.signedCookies?.[STATE_COOKIE];

    res.clearCookie(STATE_COOKIE, { path: "/auth" });

    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect(`${env.webOrigin}/?error=bad_oauth_state`);
      return;
    }

    const token = await exchangeCodeForToken(code);
    const gh = await fetchGithubUser(token);

    const existingUser = await prisma.user.findUnique({
      where: { githubId: gh.id },
      select: { role: true },
    });
    const existingAdmin = await prisma.user.findFirst({
      where: { role: "admin", id: { not: "__system__" } },
    });
    const shouldBootstrapAdmin =
      !existingAdmin &&
      env.bootstrapAdminEmail.length > 0 &&
      gh.primaryEmail === env.bootstrapAdminEmail;

    // Admins bypass the integration-org membership check so they can sign in
    // to configure the first GitHub integration (bootstrap case) and so an
    // existing admin can't get locked out if temporarily removed from every
    // org. All other users must be an active member of at least one enabled
    // kind=github Integration's org.
    const skipOrgCheck = shouldBootstrapAdmin || existingUser?.role === "admin";

    let activeLogins: string[] = [];
    if (!skipOrgCheck) {
      activeLogins = await verifyAnyOrgMembership(token);
      if (activeLogins.length === 0) {
        recordOrgDenial(ip);
        res.redirect(`${env.webOrigin}/?error=not_in_org`);
        return;
      }
      clearOrgDenial(ip);
    } else {
      clearOrgDenial(ip);
    }

    const displayName = gh.name && gh.name.length > 0 ? gh.name : gh.login;
    const avatarUrl = gh.avatarUrl;

    const user = await prisma.user.upsert({
      where: { githubId: gh.id },
      update: {
        githubLogin: gh.login,
        email: gh.primaryEmail,
        displayName,
        avatarUrl,
        lastLoginAt: new Date(),
        ...(shouldBootstrapAdmin ? { role: "admin" } : {}),
      },
      create: {
        githubId: gh.id,
        githubLogin: gh.login,
        email: gh.primaryEmail,
        displayName,
        avatarUrl,
        role: shouldBootstrapAdmin ? "admin" : "member",
        lastLoginAt: new Date(),
      },
    });

    if (user.status !== "active") {
      res.redirect(`${env.webOrigin}/?error=account_disabled`);
      return;
    }

    // Persist which orgs GitHub just confirmed for this user. The integration
    // disconnect flow reads this to identify users who must be disabled when
    // their last covering org is removed. Admins skip the org check so they
    // have no rows here, which is intentional, admins are not auto-disabled
    // on disconnect.
    if (!skipOrgCheck) {
      try {
        await syncUserOrgMemberships(user.id, activeLogins);
      } catch (err) {
        logger.error({ err, userId: user.id }, "Failed to sync UserOrgMembership after sign-in");
      }
    }

    // Drain any GitHub-team pending memberships waiting for this user. Safe
    // to call on every sign-in (idempotent, fast no-op when nothing pending).
    // Errors are logged but don't block sign-in — pending will get picked up
    // by the next webhook or weekly cron either way.
    try {
      const drained = await resolvePendingForUser(user.id, user.githubId);
      if (drained.resolved > 0 || drained.skippedExpired > 0) {
        logger.info(
          { userId: user.id, githubId: user.githubId, ...drained },
          "Resolved pending GitHub team memberships",
        );
      }
    } catch (err) {
      logger.error(
        { err, userId: user.id, githubId: user.githubId },
        "Failed to resolve pending GitHub team memberships",
      );
    }

    const auditCtx = {
      actorUserId: user.id,
      actorIp: req.ip ?? null,
      requestId: req.id != null ? String(req.id) : null,
    };

    if (shouldBootstrapAdmin) {
      await recordSystemAudit(
        "user.role.changed",
        { userId: user.id, before: "member", after: "admin" },
        { kind: "user", id: user.id },
        { ...auditCtx, actorUserId: null },
      );
    }

    await recordSystemAudit(
      "auth.signed_in",
      { userId: user.id, githubLogin: user.githubLogin },
      { kind: "user", id: user.id },
      auditCtx,
    );

    const rawToken = await createSession(user.id, req);
    setSessionCookie(res, rawToken);
    res.redirect(env.webOrigin);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", authLogoutLimiter, async (req, res, next) => {
  try {
    const raw = readSessionCookie(req);
    const userId = req.user?.id ?? null;
    await revokeSession(raw);
    clearSessionCookie(res);
    if (userId) {
      await recordSystemAudit(
        "auth.signed_out",
        { userId },
        { kind: "user", id: userId },
        {
          actorUserId: userId,
          actorIp: req.ip ?? null,
          requestId: req.id != null ? String(req.id) : null,
        },
      );
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authMeLimiter, requireAuth, (req, res) => {
  res.json(toCurrentUser(req.user!));
});

const PLANE_STATE_COOKIE = "mep_plane_oauth_state";
const PLANE_RETURN_COOKIE = "mep_plane_oauth_return";

authRouter.get("/plane", requireAuth, async (req, res) => {
  const env = loadEnv();
  let integrationId = typeof req.query.integrationId === "string" ? req.query.integrationId : "";
  const integration = integrationId
    ? await prisma.integration.findFirst({
        where: { id: integrationId, kind: "plane", enabled: true },
        select: { id: true, config: true },
      })
    : await prisma.integration.findFirst({
        where: { kind: "plane", enabled: true },
        select: { id: true, config: true },
      });
  if (!integration) {
    res.redirect(`${env.webOrigin}/settings?error=no_plane_integration`);
    return;
  }
  integrationId = integration.id;
  const cfg = integration.config as Record<string, unknown> | null;
  const clientId = typeof cfg?.oauthClientId === "string" ? cfg.oauthClientId : "";
  const baseUrl = typeof cfg?.baseUrl === "string" ? cfg.baseUrl : "";
  if (!clientId || !baseUrl) {
    res.status(503).json({ error: "Plane OAuth not configured" });
    return;
  }

  const returnUrl = typeof req.query.returnUrl === "string" ? req.query.returnUrl : "";
  if (returnUrl && returnUrl.startsWith("/")) {
    res.cookie(PLANE_RETURN_COOKIE, returnUrl, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
      path: "/auth",
      maxAge: 10 * 60 * 1000,
      signed: true,
    });
  }

  const state = `${randomBytes(16).toString("base64url")}:${integrationId}`;
  res.cookie(PLANE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/auth",
    maxAge: 10 * 60 * 1000,
    signed: true,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: `${env.webOrigin}/auth/plane/callback`,
    scope: "read write",
    state,
  });
  res.redirect(`${baseUrl}/o/authorize?${params.toString()}`);
});

authRouter.get("/plane/callback", requireAuth, async (req, res, next) => {
  try {
    const env = loadEnv();
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const expectedState = req.signedCookies?.[PLANE_STATE_COOKIE] ?? "";
    const returnUrl = req.signedCookies?.[PLANE_RETURN_COOKIE] ?? "";
    res.clearCookie(PLANE_STATE_COOKIE, { path: "/auth" });
    res.clearCookie(PLANE_RETURN_COOKIE, { path: "/auth" });

    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect(`${env.webOrigin}/workspace?error=bad_oauth_state`);
      return;
    }

    const integrationId = state.includes(":") ? state.split(":").slice(1).join(":") : "";
    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, kind: "plane" },
      select: { config: true },
    });
    const cfg = (integration?.config ?? {}) as Record<string, unknown>;
    const { decryptSecret, encryptSecret } = await import("@internal/db");
    const clientId = typeof cfg.oauthClientId === "string" ? cfg.oauthClientId : "";
    const clientSecret =
      typeof cfg.oauthClientSecret === "string" ? decryptSecret(cfg.oauthClientSecret) : "";
    const apiUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";

    if (!clientId || !clientSecret || !apiUrl) {
      res.redirect(`${env.webOrigin}/workspace?error=plane_oauth_not_configured`);
      return;
    }

    const tokenRes = await fetch(`${apiUrl}/auth/o/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${env.webOrigin}/auth/plane/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      logger.error({ status: tokenRes.status, body }, "Plane token exchange failed");
      res.redirect(`${env.webOrigin}/workspace?error=plane_token_exchange_failed`);
      return;
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const infoRes = await fetch(`${apiUrl}/auth/o/app-installation/`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = infoRes.ok
      ? ((await infoRes.json()) as { user_id: string; user_email: string })
      : { user_id: "", user_email: "" };

    await prisma.planeOAuthToken.upsert({
      where: {
        userId_integrationId: { userId: req.user!.id, integrationId },
      },
      create: {
        userId: req.user!.id,
        integrationId,
        encryptedAccessToken: encryptSecret(tokens.access_token),
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        planeUserId: info.user_id,
        planeEmail: info.user_email,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
      update: {
        encryptedAccessToken: encryptSecret(tokens.access_token),
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        planeUserId: info.user_id,
        planeEmail: info.user_email,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    const dest = returnUrl && returnUrl.startsWith("/") ? returnUrl : "/workspace";
    res.redirect(`${env.webOrigin}${dest}${dest.includes("?") ? "&" : "?"}plane_connected=true`);
  } catch (err) {
    next(err);
  }
});
