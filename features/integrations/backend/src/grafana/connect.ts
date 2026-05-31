// Grafana connect flow: probe to discover datasources, then commit with admin-chosen UIDs, plus secret rotation.

import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma, encryptSecret, decryptSecret } from "@internal/db";
import { createGrafanaClient, GrafanaApiError } from "@internal/grafana-client";
import type { GrafanaDataSource } from "@internal/grafana-client";
import { assertNonPrivateHost, PrivateBaseUrlError } from "./ssrf";

export const grafanaConnectRouter: Router = Router();

const DEFAULT_ALERT_REFIRE_SUPPRESSION_MS = 3_600_000;

// Reject http:// baseUrls only in production; dev/docker-compose-lgtm need http://localhost.
function rejectInsecureBaseUrl(baseUrl: string): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!baseUrl.startsWith("https://")) {
    return "baseUrl must be https:// in production";
  }
  return null;
}

async function runSsrfGuard(res: import("express").Response, baseUrl: string): Promise<boolean> {
  try {
    await assertNonPrivateHost(baseUrl);
    return true;
  } catch (err) {
    if (err instanceof PrivateBaseUrlError) {
      res.status(400).json({ error: err.message });
      return false;
    }
    throw err;
  }
}

interface DatasourceCandidate {
  uid: string;
  name: string;
  isDefault: boolean;
}

interface DatasourceBuckets {
  prometheus: DatasourceCandidate[];
  loki: DatasourceCandidate[];
  tempo: DatasourceCandidate[];
}

function bucketDatasources(rows: GrafanaDataSource[]): DatasourceBuckets {
  const buckets: DatasourceBuckets = { prometheus: [], loki: [], tempo: [] };
  for (const row of rows) {
    const kind = row.type?.toLowerCase();
    if (kind === "prometheus" || kind === "loki" || kind === "tempo") {
      buckets[kind].push({ uid: row.uid, name: row.name, isDefault: Boolean(row.isDefault) });
    }
  }
  const lists: DatasourceCandidate[][] = [buckets.prometheus, buckets.loki, buckets.tempo];
  for (const list of lists) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return buckets;
}

function trimmedString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeBaseUrl(raw: unknown): string {
  return trimmedString(raw).replace(/\/+$/, "");
}

grafanaConnectRouter.post("/probe", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
  const apiToken = trimmedString(req.body?.apiToken);

  if (!baseUrl || !apiToken) {
    res.status(400).json({ error: "baseUrl and apiToken are required" });
    return;
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    res.status(400).json({ error: "baseUrl must be an http(s) URL" });
    return;
  }
  const httpsError = rejectInsecureBaseUrl(baseUrl);
  if (httpsError) {
    res.status(400).json({ error: httpsError });
    return;
  }
  if (!(await runSsrfGuard(res, baseUrl))) return;

  const client = createGrafanaClient({ baseUrl, apiToken });
  let datasources: GrafanaDataSource[];
  try {
    datasources = await client.listDataSources();
  } catch (err) {
    if (err instanceof GrafanaApiError) {
      res.status(400).json({
        error: `Grafana rejected the credentials (${err.status}). Check baseUrl and the service account token.`,
      });
      return;
    }
    res.status(502).json({
      error: `Could not reach Grafana: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const buckets = bucketDatasources(datasources);
  const imageRendererAvailable = await client.checkImageRenderer();

  res.json({
    datasources: buckets,
    imageRendererAvailable,
  });
});

grafanaConnectRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const name = trimmedString(req.body?.name);
    const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
    const apiToken = trimmedString(req.body?.apiToken);
    const dsUidRaw = (req.body?.dsUid ?? {}) as Record<string, unknown>;
    const dsUid = {
      prometheus: trimmedString(dsUidRaw.prometheus),
      loki: trimmedString(dsUidRaw.loki),
      tempo: trimmedString(dsUidRaw.tempo),
    };
    const suppressionRaw = req.body?.alertRefireSuppressionMs;
    const suppressionParsed =
      typeof suppressionRaw === "number" && Number.isFinite(suppressionRaw) && suppressionRaw >= 0
        ? Math.floor(suppressionRaw)
        : null;
    const alertRefireSuppressionMs = suppressionParsed ?? DEFAULT_ALERT_REFIRE_SUPPRESSION_MS;

    if (!name || !baseUrl || !apiToken) {
      res.status(400).json({ error: "name, baseUrl, and apiToken are required" });
      return;
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      res.status(400).json({ error: "baseUrl must be an http(s) URL" });
      return;
    }
    const httpsError = rejectInsecureBaseUrl(baseUrl);
    if (httpsError) {
      res.status(400).json({ error: httpsError });
      return;
    }
    if (!(await runSsrfGuard(res, baseUrl))) return;
    if (!dsUid.prometheus) {
      res
        .status(400)
        .json({ error: "A Prometheus datasource UID is required (the scrape job needs it)" });
      return;
    }

    // Re-probe to reject chosen UIDs that no longer resolve, rather than persisting a config that fails at scrape time.
    const client = createGrafanaClient({ baseUrl, apiToken });
    let datasources: GrafanaDataSource[];
    try {
      datasources = await client.listDataSources();
    } catch (err) {
      if (err instanceof GrafanaApiError) {
        res.status(400).json({
          error: `Grafana rejected the credentials (${err.status}). Re-probe and try again.`,
        });
        return;
      }
      res.status(502).json({
        error: `Could not reach Grafana: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const validUids = new Set(datasources.map((d) => d.uid));
    const missing: string[] = [];
    if (!validUids.has(dsUid.prometheus)) missing.push(`prometheus uid=${dsUid.prometheus}`);
    if (dsUid.loki && !validUids.has(dsUid.loki)) missing.push(`loki uid=${dsUid.loki}`);
    if (dsUid.tempo && !validUids.has(dsUid.tempo)) missing.push(`tempo uid=${dsUid.tempo}`);
    if (missing.length > 0) {
      res.status(400).json({
        error: `Datasource UIDs no longer exist in Grafana: ${missing.join(", ")}. Re-probe and pick again.`,
      });
      return;
    }

    const imageRendererAvailable = await client.checkImageRenderer();
    const webhookSecret = randomBytes(32).toString("hex");

    const storedDsUid: Record<string, string> = { prometheus: dsUid.prometheus };
    if (dsUid.loki) storedDsUid.loki = dsUid.loki;
    if (dsUid.tempo) storedDsUid.tempo = dsUid.tempo;

    const integration = await prisma.integration.create({
      data: {
        name,
        description: `Grafana at ${new URL(baseUrl).host}`,
        kind: "grafana",
        enabled: true,
        config: {
          baseUrl,
          apiToken: encryptSecret(apiToken),
          dsUid: storedDsUid,
          imageRendererAvailable,
          webhookSecret: encryptSecret(webhookSecret),
          alertRefireSuppressionMs,
        },
      },
    });

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
      dsUid: storedDsUid,
      imageRendererAvailable,
      // Plaintext webhookSecret is returned exactly once for the admin to paste into Grafana's Contact Point.
      webhookSecret,
      webhookUrl: `/integrations/grafana/webhook/${integration.id}`,
    });
  } catch (err) {
    next(err);
  }
});

// Rotation endpoints exist so secrets can rotate without deleting the integration (which would cascade-delete config and alert state).
function readGrafanaIntegrationConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

grafanaConnectRouter.patch("/:id/credentials", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const apiToken = trimmedString(req.body?.apiToken);
    if (!apiToken) {
      res.status(400).json({ error: "apiToken is required" });
      return;
    }

    const existing = await prisma.integration.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, config: true },
    });
    if (!existing || existing.kind !== "grafana") {
      res.status(404).json({ error: "Grafana integration not found" });
      return;
    }
    const cfg = readGrafanaIntegrationConfig(existing.config);
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
    if (!baseUrl) {
      res.status(400).json({ error: "Integration config is missing baseUrl; re-create required" });
      return;
    }
    const httpsError = rejectInsecureBaseUrl(baseUrl);
    if (httpsError) {
      res.status(400).json({ error: httpsError });
      return;
    }
    if (!(await runSsrfGuard(res, baseUrl))) return;

    const client = createGrafanaClient({ baseUrl, apiToken });
    let datasources: GrafanaDataSource[];
    try {
      datasources = await client.listDataSources();
    } catch (err) {
      if (err instanceof GrafanaApiError) {
        res.status(400).json({
          error: `Grafana rejected the new token (${err.status}). The old token is still in effect.`,
        });
        return;
      }
      res.status(502).json({
        error: `Could not reach Grafana: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    // Confirm stored UIDs are still visible early, in case the new token is more narrowly scoped.
    const validUids = new Set(datasources.map((d) => d.uid));
    const storedDs = readGrafanaIntegrationConfig(cfg.dsUid);
    const missing: string[] = [];
    for (const key of ["prometheus", "loki", "tempo"] as const) {
      const v = storedDs[key];
      if (typeof v === "string" && v && !validUids.has(v)) missing.push(`${key} uid=${v}`);
    }
    if (missing.length > 0) {
      res.status(400).json({
        error: `New token cannot see persisted datasource UIDs: ${missing.join(", ")}. Use a token with equivalent permissions.`,
      });
      return;
    }

    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: {
        config: {
          ...cfg,
          apiToken: encryptSecret(apiToken),
        },
      },
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
  } catch (err) {
    next(err);
  }
});

// Re-probe with the stored token so the configure UI can render the picker without re-entering credentials.
grafanaConnectRouter.get("/:id/probe", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const existing = await prisma.integration.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, config: true },
    });
    if (!existing || existing.kind !== "grafana") {
      res.status(404).json({ error: "Grafana integration not found" });
      return;
    }
    const cfg = readGrafanaIntegrationConfig(existing.config);
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
    const apiTokenEnc = typeof cfg.apiToken === "string" ? cfg.apiToken : "";
    if (!baseUrl || !apiTokenEnc) {
      res.status(400).json({ error: "Integration config is incomplete; re-create required" });
      return;
    }
    const httpsError = rejectInsecureBaseUrl(baseUrl);
    if (httpsError) {
      res.status(400).json({ error: httpsError });
      return;
    }
    if (!(await runSsrfGuard(res, baseUrl))) return;

    const apiToken = decryptSecret(apiTokenEnc);
    const client = createGrafanaClient({ baseUrl, apiToken });
    let datasources: GrafanaDataSource[];
    try {
      datasources = await client.listDataSources();
    } catch (err) {
      if (err instanceof GrafanaApiError) {
        res.status(400).json({
          error: `Grafana rejected the stored credentials (${err.status}). Rotate the API token.`,
        });
        return;
      }
      res.status(502).json({
        error: `Could not reach Grafana: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const buckets = bucketDatasources(datasources);
    const imageRendererAvailable = await client.checkImageRenderer();
    res.json({ datasources: buckets, imageRendererAvailable });
  } catch (err) {
    next(err);
  }
});

// Updates non-secret config (dsUid, suppression); re-validates any new dsUid so we never persist a UID that fails at scrape time.
grafanaConnectRouter.patch("/:id/config", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const existing = await prisma.integration.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, config: true },
    });
    if (!existing || existing.kind !== "grafana") {
      res.status(404).json({ error: "Grafana integration not found" });
      return;
    }
    const cfg = readGrafanaIntegrationConfig(existing.config);
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";

    const dsUidRaw = req.body?.dsUid;
    const dsProvided = dsUidRaw && typeof dsUidRaw === "object" && !Array.isArray(dsUidRaw);
    const suppressionRaw = req.body?.alertRefireSuppressionMs;
    const suppressionProvided =
      typeof suppressionRaw === "number" && Number.isFinite(suppressionRaw) && suppressionRaw >= 0;

    if (!dsProvided && !suppressionProvided) {
      res.status(400).json({ error: "Provide dsUid and/or alertRefireSuppressionMs" });
      return;
    }

    const nextConfig: Record<string, unknown> = { ...cfg };

    if (dsProvided) {
      const ds = dsUidRaw as Record<string, unknown>;
      const dsUid = {
        prometheus: trimmedString(ds.prometheus),
        loki: trimmedString(ds.loki),
        tempo: trimmedString(ds.tempo),
      };
      if (!dsUid.prometheus) {
        res
          .status(400)
          .json({ error: "A Prometheus datasource UID is required (the scrape job needs it)" });
        return;
      }
      const apiTokenEnc = typeof cfg.apiToken === "string" ? cfg.apiToken : "";
      if (!baseUrl || !apiTokenEnc) {
        res.status(400).json({ error: "Integration config is incomplete; re-create required" });
        return;
      }
      const httpsError = rejectInsecureBaseUrl(baseUrl);
      if (httpsError) {
        res.status(400).json({ error: httpsError });
        return;
      }
      if (!(await runSsrfGuard(res, baseUrl))) return;

      const apiToken = decryptSecret(apiTokenEnc);
      const client = createGrafanaClient({ baseUrl, apiToken });
      let datasources: GrafanaDataSource[];
      try {
        datasources = await client.listDataSources();
      } catch (err) {
        if (err instanceof GrafanaApiError) {
          res.status(400).json({
            error: `Grafana rejected the stored token (${err.status}). Rotate the API token first.`,
          });
          return;
        }
        res.status(502).json({
          error: `Could not reach Grafana: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      const validUids = new Set(datasources.map((d) => d.uid));
      const missing: string[] = [];
      if (!validUids.has(dsUid.prometheus)) missing.push(`prometheus uid=${dsUid.prometheus}`);
      if (dsUid.loki && !validUids.has(dsUid.loki)) missing.push(`loki uid=${dsUid.loki}`);
      if (dsUid.tempo && !validUids.has(dsUid.tempo)) missing.push(`tempo uid=${dsUid.tempo}`);
      if (missing.length > 0) {
        res.status(400).json({
          error: `Datasource UIDs do not exist in Grafana: ${missing.join(", ")}. Re-probe and pick again.`,
        });
        return;
      }
      const storedDsUid: Record<string, string> = { prometheus: dsUid.prometheus };
      if (dsUid.loki) storedDsUid.loki = dsUid.loki;
      if (dsUid.tempo) storedDsUid.tempo = dsUid.tempo;
      nextConfig.dsUid = storedDsUid;
    }

    if (suppressionProvided) {
      nextConfig.alertRefireSuppressionMs = Math.floor(suppressionRaw as number);
    }

    await prisma.integration.update({
      where: { id: existing.id },
      data: { config: nextConfig as object },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Rotates the webhook secret; plaintext is returned once and the old secret stops working immediately (old bearer 401s).
grafanaConnectRouter.post("/:id/rotate-webhook-secret", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const existing = await prisma.integration.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, config: true },
    });
    if (!existing || existing.kind !== "grafana") {
      res.status(404).json({ error: "Grafana integration not found" });
      return;
    }
    const cfg = readGrafanaIntegrationConfig(existing.config);
    const webhookSecret = randomBytes(32).toString("hex");
    await prisma.integration.update({
      where: { id: existing.id },
      data: {
        config: {
          ...cfg,
          webhookSecret: encryptSecret(webhookSecret),
        },
      },
    });
    res.json({
      webhookSecret,
      webhookUrl: `/integrations/grafana/webhook/${existing.id}`,
    });
  } catch (err) {
    next(err);
  }
});
