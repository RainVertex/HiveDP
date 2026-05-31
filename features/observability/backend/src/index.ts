// Observability backend: health samples, per-entity config CRUD, and Loki/Tempo/dashboard proxies.

import { Router } from "express";
import { prisma } from "@internal/db";
import { GrafanaApiError } from "@internal/grafana-client";
import { loadDefaultGrafanaIntegration } from "./grafana";
import { canReadEntityObservability } from "./access";
import { prometheusScrapeJob } from "./jobs/prometheusScrape";
import { alertStateCleanupJob } from "./jobs/alertStateCleanup";
import type { ObservabilityJobDefinition } from "./jobs/types";

export type { ObservabilityJobDefinition } from "./jobs/types";
export { grafanaWebhookRouter } from "./grafanaWebhook";

export const observabilityRouter: Router = Router();

observabilityRouter.get("/health-samples", async (_req, res) => {
  const samples = await prisma.serviceHealthSample.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ items: samples });
});

observabilityRouter.get("/health-samples/:entityId", async (req, res) => {
  const samples = await prisma.serviceHealthSample.findMany({
    where: { entityId: req.params.entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ items: samples });
});

// PUT is an upsert so the UI can create-or-update via a single endpoint.

function toConfigDto(row: {
  entityId: string;
  integrationId: string;
  upQuery: string | null;
  latencyQuery: string | null;
  errorQuery: string | null;
  logsSelector: string | null;
  dashboardUid: string | null;
  traceIdRegex: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    entityId: row.entityId,
    integrationId: row.integrationId,
    upQuery: row.upQuery,
    latencyQuery: row.latencyQuery,
    errorQuery: row.errorQuery,
    logsSelector: row.logsSelector,
    dashboardUid: row.dashboardUid,
    traceIdRegex: row.traceIdRegex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

observabilityRouter.get("/entities/:entityId/config", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!(await canReadEntityObservability(req.user, req.params.entityId))) {
    res.status(403).json({ error: "Not a member of the entity's owning team(s)" });
    return;
  }
  const row = await prisma.entityObservabilityConfig.findUnique({
    where: { entityId: req.params.entityId },
  });
  if (!row) {
    res.status(404).json({ error: "No observability config for entity" });
    return;
  }
  res.json(toConfigDto(row));
});

observabilityRouter.put("/entities/:entityId/config", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const integrationId = String(req.body?.integrationId ?? "").trim();
    if (!integrationId) {
      res.status(400).json({ error: "integrationId is required" });
      return;
    }
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, kind: true },
    });
    if (!integration || integration.kind !== "grafana") {
      res.status(400).json({ error: "integrationId must reference a Grafana integration" });
      return;
    }
    const entity = await prisma.catalogEntity.findUnique({
      where: { id: req.params.entityId },
      select: { id: true },
    });
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }

    const fields = {
      upQuery: nullableString(req.body?.upQuery),
      latencyQuery: nullableString(req.body?.latencyQuery),
      errorQuery: nullableString(req.body?.errorQuery),
      logsSelector: nullableString(req.body?.logsSelector),
      dashboardUid: nullableString(req.body?.dashboardUid),
      traceIdRegex: nullableString(req.body?.traceIdRegex),
    };

    const row = await prisma.entityObservabilityConfig.upsert({
      where: { entityId: req.params.entityId },
      update: { integrationId, ...fields },
      create: { entityId: req.params.entityId, integrationId, ...fields },
    });

    res.json(toConfigDto(row));
  } catch (err) {
    next(err);
  }
});

observabilityRouter.delete("/entities/:entityId/config", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    await prisma.entityObservabilityConfig.deleteMany({
      where: { entityId: req.params.entityId },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

observabilityRouter.get("/logs", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const entityId = String(req.query.entityId ?? "").trim();
    if (!entityId) {
      res.status(400).json({ error: "entityId is required" });
      return;
    }
    if (!(await canReadEntityObservability(req.user, entityId))) {
      res.status(403).json({ error: "Not a member of the entity's owning team(s)" });
      return;
    }
    const minutes = clampNumber(req.query.minutes, 15, 1, 24 * 60);
    const limit = clampNumber(req.query.limit, 200, 1, 1000);

    const cfg = await prisma.entityObservabilityConfig.findUnique({
      where: { entityId },
      select: { logsSelector: true, traceIdRegex: true },
    });
    if (!cfg || !cfg.logsSelector) {
      res.status(404).json({ error: "Entity has no Loki selector configured" });
      return;
    }
    const integration = await loadDefaultGrafanaIntegration();
    if (!integration) {
      res.status(503).json({ error: "No enabled Grafana integration" });
      return;
    }
    if (!integration.dsUid.loki) {
      res.status(503).json({ error: "Grafana integration has no Loki datasource configured" });
      return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    const items = await integration.client.logsQuery(
      integration.dsUid.loki,
      cfg.logsSelector,
      { start, end, limit, direction: "backward" },
      cfg.traceIdRegex ? { traceIdRegex: cfg.traceIdRegex } : undefined,
    );
    res.json({ items });
  } catch (err) {
    if (err instanceof GrafanaApiError) {
      res.status(502).json({
        error: `Grafana Loki proxy returned ${err.status}`,
        detail: err.body.slice(0, 500),
      });
      return;
    }
    next(err);
  }
});

observabilityRouter.get("/traces/:traceId", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Trace IDs have no inherent ownership, so authz is gated on the caller-declared entity.
    const entityId = String(req.query.entityId ?? "").trim();
    if (!entityId) {
      res.status(400).json({ error: "entityId is required" });
      return;
    }
    if (!(await canReadEntityObservability(req.user, entityId))) {
      res.status(403).json({ error: "Not a member of the entity's owning team(s)" });
      return;
    }
    const integration = await loadDefaultGrafanaIntegration();
    if (!integration) {
      res.status(503).json({ error: "No enabled Grafana integration" });
      return;
    }
    if (!integration.dsUid.tempo) {
      res.status(503).json({ error: "Grafana integration has no Tempo datasource configured" });
      return;
    }
    const trace = await integration.client.traceById(integration.dsUid.tempo, req.params.traceId);
    res.json(trace);
  } catch (err) {
    if (err instanceof GrafanaApiError) {
      res.status(502).json({
        error: `Grafana Tempo proxy returned ${err.status}`,
        detail: err.body.slice(0, 500),
      });
      return;
    }
    next(err);
  }
});

observabilityRouter.get("/dashboard-image", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const dashboardUid = String(req.query.dashboardUid ?? "").trim();
    const panelId = Number(req.query.panelId);
    if (!dashboardUid || !Number.isFinite(panelId)) {
      res.status(400).json({ error: "dashboardUid and panelId are required" });
      return;
    }
    // Dashboards have no entity ownership: non-admins must read an entity that pinned this UID.
    if (req.user.role !== "admin") {
      const entityId = String(req.query.entityId ?? "").trim();
      if (!entityId) {
        res.status(400).json({ error: "entityId is required for non-admin requests" });
        return;
      }
      if (!(await canReadEntityObservability(req.user, entityId))) {
        res.status(403).json({ error: "Not a member of the entity's owning team(s)" });
        return;
      }
      const cfg = await prisma.entityObservabilityConfig.findUnique({
        where: { entityId },
        select: { dashboardUid: true },
      });
      if (!cfg || cfg.dashboardUid !== dashboardUid) {
        res.status(403).json({
          error: "Requested dashboardUid is not the one pinned to this entity",
        });
        return;
      }
    }
    const integration = await loadDefaultGrafanaIntegration();
    if (!integration) {
      res.status(503).json({ error: "No enabled Grafana integration" });
      return;
    }
    if (!integration.imageRendererAvailable) {
      res
        .status(404)
        .json({ error: "Grafana image renderer plugin is not installed on this Grafana" });
      return;
    }
    const png = await integration.client.renderPanel({
      dashboardUid,
      panelId,
      from: optionalString(req.query.from),
      to: optionalString(req.query.to),
      width: optionalNumber(req.query.w),
      height: optionalNumber(req.query.h),
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=30");
    res.send(png);
  } catch (err) {
    if (err instanceof GrafanaApiError) {
      res
        .status(502)
        .json({ error: `Grafana render returned ${err.status}`, detail: err.body.slice(0, 500) });
      return;
    }
    next(err);
  }
});

export function getObservabilityJobs(): ObservabilityJobDefinition[] {
  return [prometheusScrapeJob(), alertStateCleanupJob()];
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
