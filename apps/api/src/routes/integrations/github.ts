// GitHub App install lifecycle. Two HTTP entry points:
//
//   GET /api/integrations/github/install
//     Admin-initiated. Sets a signed cookie identifying the initiator,
//     redirects to GitHub's install URL.
//
//   GET /api/integrations/github/callback
//     GitHub redirects here after the admin completes installation.
//     Verifies the cookie, fetches installation metadata, upserts an
//     Integration row, redirects back to the web app.
//
// The webhook receiver lives separately at /integrations/github/app-webhook
// because it must be mounted before express.json() — it's wired in
// createServer.ts.

import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "@internal/db";
import {
  disableStrandedUsers,
  GitHubAppNotConfiguredError,
  loadGitHubAppConfig,
  octokitAsApp,
  recordInstallation,
  recordUninstallation,
} from "@feature/integrations-backend";
import {
  runReconciliation,
  staleEntitiesForInstallation,
  syncInstallation,
} from "@feature/catalog-backend";
import { loadEnv } from "../../config/env";
import { recordAudit } from "../../audit/audit";
import { logger } from "../../logger/logger";

const INITIATOR_COOKIE = "mep_github_install_initiator";
const COOKIE_PATH = "/api/integrations/github";
const COOKIE_TTL_MS = 10 * 60 * 1000;

export const githubIntegrationRouter: Router = Router();

githubIntegrationRouter.get("/install", (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const cfg = loadGitHubAppConfig();
  if (!cfg.ok) {
    res.status(503).json({ error: "GitHub App not configured", missing: cfg.missing });
    return;
  }

  const env = loadEnv();
  // The cookie is the only flow-state we need: it proves the initiator was
  // an authenticated admin in this session. GitHub doesn't reliably forward
  // a `state` query param through the App install flow (it's an OAuth
  // concern, not an App concern), so we don't bother with one.
  const nonce = randomBytes(16).toString("base64url");
  res.cookie(INITIATOR_COOKIE, `${req.user.id}.${nonce}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: COOKIE_PATH,
    maxAge: COOKIE_TTL_MS,
    signed: true,
  });
  res.redirect(`https://github.com/apps/${cfg.slug}/installations/new`);
});

githubIntegrationRouter.get("/callback", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const env = loadEnv();
    const installationIdRaw =
      typeof req.query.installation_id === "string" ? req.query.installation_id : "";
    const setupAction = typeof req.query.setup_action === "string" ? req.query.setup_action : "";

    const expectedCookie = req.signedCookies?.[INITIATOR_COOKIE];
    res.clearCookie(INITIATOR_COOKIE, { path: COOKIE_PATH });

    if (!expectedCookie || !expectedCookie.startsWith(`${req.user.id}.`)) {
      res.redirect(`${env.webOrigin}/integrations?error=github_install_state`);
      return;
    }

    const installationId = Number.parseInt(installationIdRaw, 10);
    if (!Number.isFinite(installationId) || installationId <= 0) {
      res.redirect(`${env.webOrigin}/integrations?error=github_install_id`);
      return;
    }

    if (setupAction !== "install" && setupAction !== "update") {
      // "request" means an org member asked an org admin to install — nothing
      // to record on our side.
      res.redirect(`${env.webOrigin}/integrations?info=github_install_pending`);
      return;
    }

    let result;
    try {
      result = await recordInstallation(installationId);
    } catch (err) {
      if (err instanceof GitHubAppNotConfiguredError) {
        res.status(503).json({ error: "GitHub App not configured", missing: err.missing });
        return;
      }
      throw err;
    }

    await recordAudit(
      req,
      "integration.created",
      { integrationId: result.integrationId, kind: "github" },
      { kind: "integration", id: result.integrationId },
    );

    // Fire-and-forget: bulk sync iterates every accessible repo and can take
    // minutes for large orgs. We respond to the admin immediately and let
    // the sync run in the background. Errors are logged; the admin can
    // re-trigger via /api/integrations/github/sync (Phase 3) if anything
    // didn't make it.
    void syncInstallation(installationId).then(
      (summary) => {
        logger.info(
          {
            installationId,
            integrationId: result.integrationId,
            reposExamined: summary.reposExamined,
            created: summary.created,
            updated: summary.updated,
            withCatalogInfo: summary.withCatalogInfo,
            needsOnboarding: summary.needsOnboarding,
            errors: summary.errors.length,
            durationMs: summary.finishedAt.getTime() - summary.startedAt.getTime(),
          },
          "github-app: bulk sync completed",
        );
      },
      (err) => {
        logger.error(
          { err, installationId, integrationId: result.integrationId },
          "github-app: bulk sync failed",
        );
      },
    );

    res.redirect(`${env.webOrigin}/integrations?installed=github`);
  } catch (err) {
    next(err);
  }
});

// Manually trigger a differential reconciliation. Used by the admin "Resync"
// button on the integrations page and by post-incident recovery scripts.
// Always re-fetches from GitHub and applies the diff — never a full
// re-import. Idempotent and safe to run while webhooks are firing.
githubIntegrationRouter.post("/:integrationId/resync", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const integrationId = req.params.integrationId;
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, kind: true, config: true, enabled: true },
    });
    if (!integration || integration.kind !== "github") {
      res.status(404).json({ error: "GitHub integration not found" });
      return;
    }
    if (!integration.enabled) {
      res.status(409).json({ error: "Integration is disabled" });
      return;
    }
    const cfg =
      integration.config &&
      typeof integration.config === "object" &&
      !Array.isArray(integration.config)
        ? (integration.config as Record<string, unknown>)
        : {};
    const installationId = Number(cfg.installationId);
    if (!Number.isFinite(installationId)) {
      res.status(400).json({ error: "Integration has no installationId in config" });
      return;
    }

    const run = await runReconciliation(installationId, "manual");
    await recordAudit(
      req,
      "integration.resynced",
      { integrationId: integration.id, kind: "github", runId: run.runId },
      { kind: "integration", id: integration.id },
    );
    res.json(run);
  } catch (err) {
    next(err);
  }
});

// Drift summary for the inline integrations-page badge. Returns just enough
// for "is there drift?" + a short stale-team list. Detection itself is
// backend-driven (webhook + weekly cron); this endpoint is read-only.
githubIntegrationRouter.get("/:integrationId/drift", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.integrationId },
      select: { id: true, kind: true, config: true },
    });
    if (!integration || integration.kind !== "github") {
      res.status(404).json({ error: "GitHub integration not found" });
      return;
    }
    const cfg =
      integration.config &&
      typeof integration.config === "object" &&
      !Array.isArray(integration.config)
        ? (integration.config as Record<string, unknown>)
        : {};
    const installationId = Number(cfg.installationId);
    if (!Number.isFinite(installationId)) {
      res.status(400).json({ error: "Integration has no installationId in config" });
      return;
    }

    const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);

    const [staleTeams, latestRun, pendingCount] = await Promise.all([
      prisma.team.findMany({
        where: {
          source: "github",
          installationId,
          deletedAt: null,
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleCutoff } }],
        },
        select: { id: true, name: true, lastSyncedAt: true },
        orderBy: { lastSyncedAt: "asc" },
        take: 20,
      }),
      prisma.githubReconciliationRun.findFirst({
        where: { installationId },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      }),
      prisma.pendingTeamMembership.count({
        where: { team: { installationId, source: "github" } },
      }),
    ]);

    const staleTeamCount = await prisma.team.count({
      where: {
        source: "github",
        installationId,
        deletedAt: null,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleCutoff } }],
      },
    });

    res.json({
      installationId,
      staleTeamCount,
      pendingMemberCount: pendingCount,
      lastReconciliationAt: latestRun?.startedAt.toISOString() ?? null,
      staleTeams: staleTeams.map((t) => ({
        id: t.id,
        name: t.name,
        lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Platform-side disconnect. Single endpoint that converges on the same end
// state as the installation.deleted webhook:
//   1. Revoke the App on GitHub (apps.deleteInstallation), tolerating 404.
//   2. recordUninstallation → Integration.enabled = false.
//   3. Stale every entity tied to the installation.
//   4. Hard-delete the Integration row IFF no entities remain pointing at it
//      (otherwise keep it, disabled, so audit lineage stays intact).
githubIntegrationRouter.delete("/:integrationId", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const integrationId = req.params.integrationId;
    if (typeof integrationId !== "string" || integrationId.length === 0) {
      res.status(400).json({ error: "integrationId required" });
      return;
    }

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, kind: true, config: true },
    });
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    if (integration.kind !== "github") {
      res.status(400).json({ error: "Not a github integration" });
      return;
    }

    const cfg =
      integration.config &&
      typeof integration.config === "object" &&
      !Array.isArray(integration.config)
        ? (integration.config as Record<string, unknown>)
        : {};
    const installationId = Number(cfg.installationId);
    if (!Number.isFinite(installationId)) {
      res.status(400).json({ error: "Integration has no installationId in config" });
      return;
    }

    // 1. Revoke on GitHub. Tolerate 404 (already uninstalled externally) and
    // 422 (some installations are already gone) so the platform-side cleanup
    // still proceeds.
    let githubRevoked = false;
    try {
      const appOcto = await octokitAsApp();
      await appOcto.rest.apps.deleteInstallation({ installation_id: installationId });
      githubRevoked = true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 422) {
        githubRevoked = false;
      } else if (err instanceof GitHubAppNotConfiguredError) {
        // App credentials are missing — we can't talk to GitHub. Still
        // proceed with the platform-side cleanup since the user explicitly
        // asked to disconnect.
        logger.warn(
          { installationId, integrationId },
          "github-app: cannot revoke installation, App credentials missing — proceeding with platform-side cleanup only",
        );
      } else {
        throw err;
      }
    }

    // 2. Mark Integration disabled.
    await recordUninstallation(installationId);

    // 3. Disable users whose only org coverage was this one and kill their
    // sessions, so they don't keep accessing the platform with a stale
    // session. Helper is idempotent and admin-safe.
    const accountLogin = typeof cfg.accountLogin === "string" ? cfg.accountLogin : "";
    const { disabledUserIds } = await disableStrandedUsers(accountLogin);

    // 4. Stale every entity tied to the installation.
    const staledCount = await staleEntitiesForInstallation(installationId);

    // 5. Drop the Integration row only if no entities point at it. Keeping
    // the row preserves audit lineage; once all entities are hard-deleted
    // (e.g. via a future cleanup), the next disconnect attempt removes the
    // row too.
    const remaining = await prisma.catalogEntity.count({ where: { installationId } });
    let integrationRemoved = false;
    if (remaining === 0) {
      await prisma.integration.delete({ where: { id: integration.id } });
      integrationRemoved = true;
    }

    await recordAudit(
      req,
      "integration.disconnected",
      {
        integrationId: integration.id,
        kind: "github",
        accountLogin,
        disabledUserCount: disabledUserIds.length,
        source: "admin_action",
      },
      { kind: "integration", id: integration.id },
    );

    logger.info(
      {
        installationId,
        integrationId: integration.id,
        githubRevoked,
        staledCount,
        integrationRemoved,
        disabledUserCount: disabledUserIds.length,
      },
      "github-app: disconnected",
    );

    res.json({
      ok: true,
      githubRevoked,
      staledEntities: staledCount,
      integrationRemoved,
      disabledUserCount: disabledUserIds.length,
    });
  } catch (err) {
    next(err);
  }
});
