// Admin integrations router (list/get/patch/delete) plus GitHub App helper re-exports.
import { Router } from "express";
import { prisma } from "@internal/db";
import type { IntegrationKind, IntegrationDetail } from "@internal/shared-types";
import { disconnectGitHubInstallation } from "./github-app/install";
import { grafanaConnectRouter } from "./grafana/connect";

// Per-kind safe view of stored config: strips encrypted secrets, exposes has* flags instead.
function safeConfigForKind(kind: IntegrationKind, raw: unknown): IntegrationDetail["config"] {
  const cfg =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const hasNonEmpty = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  switch (kind) {
    case "grafana": {
      const ds =
        cfg.dsUid && typeof cfg.dsUid === "object" && !Array.isArray(cfg.dsUid)
          ? (cfg.dsUid as Record<string, unknown>)
          : {};
      const dsUid: { prometheus: string; loki?: string; tempo?: string } = {
        prometheus: str(ds.prometheus),
      };
      if (str(ds.loki)) dsUid.loki = str(ds.loki);
      if (str(ds.tempo)) dsUid.tempo = str(ds.tempo);
      return {
        baseUrl: str(cfg.baseUrl),
        dsUid,
        imageRendererAvailable: Boolean(cfg.imageRendererAvailable),
        alertRefireSuppressionMs:
          typeof cfg.alertRefireSuppressionMs === "number" ? cfg.alertRefireSuppressionMs : 0,
        hasApiToken: hasNonEmpty(cfg.apiToken),
        hasWebhookSecret: hasNonEmpty(cfg.webhookSecret),
      };
    }
    case "github":
      return {
        accountLogin: str(cfg.accountLogin),
        installationId:
          typeof cfg.installationId === "number"
            ? cfg.installationId
            : Number(cfg.installationId) || 0,
      };
    case "jira":
    case "slack":
      return {} as Record<string, never>;
  }
}

export {
  recordInstallation,
  recordUninstallation,
  fetchInstallationMetadata,
  cascadeStaleByInstallationId,
  revokeAppInstallation,
  disconnectGitHubInstallation,
} from "./github-app/install";
export { revokeStrandedUserSessions } from "./github-app/uninstall-effects";
export type {
  InstallationMetadata,
  RecordInstallationResult,
  DisconnectResult,
} from "./github-app/install";
export { loadGitHubAppConfig, isAppConfigured } from "./github-app/config";
export type { GitHubAppConfig, GitHubAppConfigResult } from "./github-app/config";
export {
  octokitForInstallation,
  octokitAsApp,
  GitHubAppNotConfiguredError,
} from "./github-app/octokit";
export { verifyGitHubSignature } from "./github-app/webhook-verify";

export const integrationsRouter: Router = Router();

// Mounted as a sub-path so its specific routes don't collide with the generic PATCH/DELETE /:id below.
integrationsRouter.use("/grafana", grafanaConnectRouter);

integrationsRouter.get("/", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const integrations = await prisma.integration.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      kind: true,
      enabled: true,
      // Never return config: it carries encrypted secrets.
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({
    items: integrations.map((i) => ({
      ...i,
      config: {},
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
  });
});

// Public org-login summary for the team-request form's org dropdown, visible to any authenticated member.
integrationsRouter.get("/github/installations", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const rows = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { id: true, name: true, config: true },
    orderBy: { name: "asc" },
  });
  const items = rows
    .map((row) => {
      const cfg = row.config;
      const accountLogin =
        cfg && typeof cfg === "object" && !Array.isArray(cfg)
          ? ((cfg as Record<string, unknown>).accountLogin as unknown)
          : null;
      return {
        integrationId: row.id,
        name: row.name,
        accountLogin: typeof accountLogin === "string" ? accountLogin : "",
      };
    })
    .filter((i) => i.accountLogin.length > 0);
  res.json({ items });
});

integrationsRouter.get("/:id", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const row = await prisma.integration.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      description: true,
      kind: true,
      enabled: true,
      config: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }
  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    enabled: row.enabled,
    config: safeConfigForKind(row.kind as IntegrationKind, row.config),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

integrationsRouter.patch("/:id", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const enabledRaw = req.body?.enabled;
  if (typeof enabledRaw !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }
  const updated = await prisma.integration.update({
    where: { id: req.params.id },
    data: { enabled: enabledRaw },
  });
  res.json({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    kind: updated.kind,
    enabled: updated.enabled,
    config: {},
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

integrationsRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const integ = await prisma.integration.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true },
    });
    if (!integ) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    if (integ.kind === "github") {
      const result = await disconnectGitHubInstallation(integ.id);
      await prisma.auditEvent.create({
        data: {
          actorUserId: req.user.id,
          actorIp: req.ip ?? null,
          requestId: req.id != null ? String(req.id) : null,
          kind: "integration.disconnected",
          targetKind: "integration",
          targetId: integ.id,
          payload: {
            integrationId: integ.id,
            kind: "github",
            accountLogin: result.accountLogin,
            affectedUserCount: result.affectedUserIds.length,
            source: "admin_action",
          },
        },
      });
      res.json({
        disconnected: true,
        installationId: result.installationId,
        entitiesStaled: result.entitiesStaled,
        revoked: result.revoked,
        revokeReason: result.revokeReason,
        affectedUserCount: result.affectedUserIds.length,
      });
      return;
    }

    await prisma.integration.delete({ where: { id: integ.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
