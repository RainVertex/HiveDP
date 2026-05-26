// Integrations REST surface. Generic listing + per-provider connect flows.
// Plane is the first concrete provider; future GitHub/OpenProject/etc. flows
// land alongside in their own files when added.

import { Router } from "express";
import { prisma, encryptSecret } from "@internal/db";
import { createPlaneClient, PlaneApiError } from "@internal/plane-client";
import type { IntegrationKind, IntegrationDetail } from "@internal/shared-types";
import { fullSync } from "@feature/workspace-backend";
import { disconnectGitHubInstallation } from "./github-app/install";
import { grafanaConnectRouter } from "./grafana/connect";

// Per-kind "safe view" of an integration's stored config. Strips encrypted
// secrets (apiToken, webhookSecret) and exposes only fields the admin needs
// to see in the configure UI. Boolean `has*` flags let the UI render a
// "set / not set" indicator without leaking the value itself.
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
    case "plane":
      return {
        baseUrl: str(cfg.baseUrl),
        workspaceSlug: str(cfg.workspaceSlug),
        hasApiToken: hasNonEmpty(cfg.apiToken),
        hasWebhookSecret: hasNonEmpty(cfg.webhookSecret),
      };
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

// Grafana connect flow (probe + commit). Mounted as a sub-path so the more
// specific routes (`/grafana/probe`, `POST /grafana`) don't collide with the
// generic `PATCH /:id` / `DELETE /:id` below.
integrationsRouter.use("/grafana", grafanaConnectRouter);

integrationsRouter.get("/", async (_req, res) => {
  const integrations = await prisma.integration.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      kind: true,
      enabled: true,
      // Never return config — it carries encrypted secrets.
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({
    items: integrations.map((i) => ({
      ...i,
      // Frontend expects a `config` field on Integration; redact contents.
      config: {},
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /github/installations
// ---------------------------------------------------------------------------
// Public-org-login summary used by the team-request form to populate the
// "Mirror to GitHub — which org?" dropdown. Authenticated members can see it
// (the org login is public). Excludes any installation missing accountLogin
// in its config (e.g. mid-install).

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

// ---------------------------------------------------------------------------
// Plane connect flow
// ---------------------------------------------------------------------------
// 1. Validate the API token by calling GET /workspaces/<slug>/.
// 2. Persist an Integration row with the encrypted token + a freshly
//    generated webhook secret. The slug is also stored for fast lookup.
// 3. Kick off a full sync inline so the connecting admin sees data
//    immediately. If the sync fails the integration row is rolled back so
//    the user can fix and retry.

integrationsRouter.post("/plane", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const name = String(req.body?.name ?? "").trim();
  const baseUrl = String(req.body?.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const apiToken = String(req.body?.apiToken ?? "").trim();
  const workspaceSlug = String(req.body?.workspaceSlug ?? "").trim();

  if (!name || !baseUrl || !apiToken || !workspaceSlug) {
    res.status(400).json({
      error: "name, baseUrl, apiToken, and workspaceSlug are all required",
    });
    return;
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    res.status(400).json({ error: "baseUrl must be an http(s) URL" });
    return;
  }

  const existing = await prisma.integration.findFirst({
    where: {
      kind: "plane",
      AND: [
        { config: { path: ["baseUrl"], equals: baseUrl } },
        { config: { path: ["workspaceSlug"], equals: workspaceSlug } },
      ],
    },
    select: { id: true, name: true },
  });
  if (existing) {
    res.status(409).json({
      error: `Already connected as "${existing.name}". Disconnect it first if you need to rotate credentials.`,
      existingIntegrationId: existing.id,
    });
    return;
  }

  // Validate by listing projects. We can't use GET /workspaces/<slug>/ because
  // Plane's personal API tokens don't authenticate that endpoint (it's
  // session-only). The projects endpoint accepts X-API-Key, so a successful
  // response confirms both the token and the workspace slug in one call.
  const workspaceName = workspaceSlug;
  try {
    const probe = createPlaneClient({ baseUrl, apiToken });
    await probe.listProjects(workspaceSlug);
  } catch (err) {
    if (err instanceof PlaneApiError) {
      res.status(400).json({
        error: `Plane rejected the credentials (${err.status}). Check the API token and workspace slug.`,
      });
      return;
    }
    res.status(502).json({
      error: `Could not reach Plane: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Plane generates and owns the webhook secret — it's shown ONCE on
  // Plane's webhook creation page and never again. We can't generate one
  // and tell Plane to use it. So we create the integration with no
  // webhook secret yet; the admin pastes Plane's secret afterward via
  // PATCH /api/integrations/:id/webhook-secret. Until then, our receiver
  // returns 503 to incoming webhooks.
  const integration = await prisma.integration.create({
    data: {
      name,
      description: `Plane workspace ${workspaceSlug} at ${new URL(baseUrl).host}`,
      kind: "plane",
      enabled: true,
      config: {
        baseUrl,
        apiToken: encryptSecret(apiToken),
        workspaceSlug,
      },
    },
  });

  // Kick the initial sync inline so the connect-flow caller gets back a
  // populated workspace. If the sync throws we still keep the integration
  // row — the admin can retry via /api/workspace/integrations/:id/sync.
  let syncError: string | null = null;
  try {
    await fullSync(integration.id);
  } catch (err) {
    syncError = err instanceof Error ? err.message : String(err);
  }

  res.json({
    integration: {
      id: integration.id,
      name: integration.name,
      description: integration.description,
      kind: integration.kind,
      enabled: integration.enabled,
      config: {},
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    },
    workspaceName,
    // Webhook setup is a two-step flow (Plane owns the secret):
    //   1. Create a webhook in Plane with this URL as the payload URL.
    //   2. Plane shows you a secret like `plane_wh_<hex>` exactly once —
    //      paste it into the integration detail page in our platform.
    webhookUrl: `/integrations/plane/webhook/${integration.id}`,
    syncError,
  });
});

// Set or rotate the webhook secret. Called after the admin creates the
// webhook in Plane and copies the secret Plane generated.
integrationsRouter.patch("/:id/webhook-secret", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const webhookSecret = String(req.body?.webhookSecret ?? "").trim();
  if (!webhookSecret) {
    res.status(400).json({ error: "webhookSecret is required" });
    return;
  }
  const existing = await prisma.integration.findUnique({
    where: { id: req.params.id },
    select: { id: true, kind: true, config: true },
  });
  if (!existing || existing.kind !== "plane") {
    res.status(404).json({ error: "Plane integration not found" });
    return;
  }
  const config =
    existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {};
  await prisma.integration.update({
    where: { id: existing.id },
    data: {
      config: {
        ...config,
        webhookSecret: encryptSecret(webhookSecret),
      },
    },
  });
  res.status(204).end();
});

// Per-integration detail. Returns the row plus a per-kind safe view of the
// stored config so the admin configure page can render real values without
// the secrets ever crossing the wire. Admin-only, like PATCH/DELETE below.
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

// Generic toggle/disconnect — works for any kind. Disconnect cascades to
// Plane mirror tables via the Integration FK.

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

    // GitHub disconnect cascades: stale-mark every CatalogEntity tied to the
    // installation, revoke the App on GitHub so webhooks stop firing, disable
    // any users whose only covering org was this one (helper inside
    // disconnectGitHubInstallation), then remove the Integration row.
    // Re-installing the same org rehydrates the entities via githubRepoId,
    // so this is reversible without data loss. Disabled users have to be
    // re-enabled manually by an admin once their org is back.
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
