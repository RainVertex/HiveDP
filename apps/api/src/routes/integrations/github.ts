// GitHub App install/callback/resync/disconnect endpoints (admin only).
// Webhook receiver lives separately in createServer.ts (must mount before express.json()).
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "@internal/db";
import {
  GitHubAppNotConfiguredError,
  loadGitHubAppConfig,
  octokitAsApp,
  recordInstallation,
  recordUninstallation,
  revokeStrandedUserSessions,
} from "@feature/integrations-backend";
import {
  runReconciliation,
  staleEntitiesForInstallation,
  syncInstallation,
} from "@feature/catalog-backend";
import {
  provisionProjectsForInstallation,
  reconcileProjectMembersForInstallation,
} from "@feature/projects-backend";
import { loadEnv } from "../../config/env";
import { recordAudit } from "../../audit/audit";
import { logger } from "../../logger/logger";
import { runJob } from "../../jobs";

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
  // Cookie is the only flow-state; GitHub doesn't forward `state` through the App install flow.
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
      // "request" means an org member asked an admin to install; nothing to record.
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

    // Stamp installer id so auto-provisioned projects for unowned repos can fall back to this user as ADMIN.
    const integrationRow = await prisma.integration.findUnique({
      where: { id: result.integrationId },
      select: { config: true },
    });
    const existingConfig =
      integrationRow?.config &&
      typeof integrationRow.config === "object" &&
      !Array.isArray(integrationRow.config)
        ? (integrationRow.config as Record<string, unknown>)
        : {};
    await prisma.integration.update({
      where: { id: result.integrationId },
      data: { config: { ...existingConfig, installerUserId: req.user.id } },
    });

    await recordAudit(
      req,
      "integration.created",
      { integrationId: result.integrationId, kind: "github" },
      { kind: "integration", id: result.integrationId },
    );

    // Fire-and-forget: bulk sync can take minutes for large orgs, so respond immediately.
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
        // Drain the agent task queue now so a freshly connected org's enrich tasks run on connect,
        // not at the next scheduled tick. Catalog enrichment is a chat-runtime agent, so the queue
        // drain (which the bulk sync just filled with catalog-enrich tasks) handles it.
        void runJob("agents.taskQueue", "manual").catch((err) => {
          logger.error({ err, installationId }, "github-app: enricher kick after sync failed");
        });
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

// Differential reconciliation; idempotent and safe to run while webhooks are firing.
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
    // Propagate any team-repo grant changes into project membership before responding.
    try {
      await reconcileProjectMembersForInstallation(installationId);
    } catch (err) {
      logger.error(
        { err, installationId },
        "github-app: project member reconcile after resync failed",
      );
    }
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

// Re-provision PM Projects for every repo in this installation; idempotent.
githubIntegrationRouter.post("/:integrationId/provision-projects", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.integrationId },
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
    const summary = await provisionProjectsForInstallation(installationId, "manual");
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Read-only drift summary for the integrations-page badge.
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

// Platform-side disconnect; converges on the same end state as the installation.deleted webhook.
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

    // Tolerate 404/422 (already uninstalled externally) so platform-side cleanup still proceeds.
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
        // Credentials missing; still proceed with platform-side cleanup since disconnect was requested.
        logger.warn(
          { installationId, integrationId },
          "github-app: cannot revoke installation, App credentials missing — proceeding with platform-side cleanup only",
        );
      } else {
        throw err;
      }
    }

    await recordUninstallation(installationId);

    // Revoke sessions for users whose only org coverage was this installation.
    const accountLogin = typeof cfg.accountLogin === "string" ? cfg.accountLogin : "";
    const { affectedUserIds } = await revokeStrandedUserSessions(accountLogin);

    const staledCount = await staleEntitiesForInstallation(installationId);

    // Drop the Integration row only if no entities point at it, to preserve audit lineage.
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
        affectedUserCount: affectedUserIds.length,
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
        affectedUserCount: affectedUserIds.length,
      },
      "github-app: disconnected",
    );

    res.json({
      ok: true,
      githubRevoked,
      staledEntities: staledCount,
      integrationRemoved,
      affectedUserCount: affectedUserIds.length,
    });
  } catch (err) {
    next(err);
  }
});
