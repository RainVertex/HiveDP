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

    if (!skipOrgCheck) {
      const inOrg = await verifyAnyOrgMembership(token);
      if (!inOrg) {
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
