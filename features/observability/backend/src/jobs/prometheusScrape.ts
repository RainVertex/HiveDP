// Prometheus scrape job: sweeps ALL enabled Grafana integrations (configs are integration-scoped) with allSettled to isolate failures.

import { prisma } from "@internal/db";
import { GrafanaApiError } from "@internal/grafana-client";
import type { ObservabilityJobDefinition } from "./types";
import { loadGrafanaIntegrations, type GrafanaIntegrationRecord } from "../grafana";

const CHUNK_SIZE = 10;

function extractScalarValue(payload: {
  data?: { result?: Array<{ value?: [number, string] }> };
}): number | null {
  const first = payload.data?.result?.[0]?.value;
  if (!first) return null;
  const n = Number(first[1]);
  return Number.isFinite(n) ? n : null;
}

function deriveStatus(
  up: number | null,
  errorRate: number | null,
): "healthy" | "degraded" | "down" {
  if (up === null) return "down";
  if (up < 1) return "down";
  if (errorRate !== null && errorRate > 0.05) return "degraded";
  return "healthy";
}

async function scrapeEntity(
  integration: GrafanaIntegrationRecord,
  prometheusUid: string,
  cfg: {
    entityId: string;
    upQuery: string | null;
    latencyQuery: string | null;
    errorQuery: string | null;
  },
): Promise<void> {
  if (!cfg.upQuery) return;
  const upRes = await integration.client.query(prometheusUid, cfg.upQuery);
  const up = extractScalarValue(upRes);

  let latencyMs: number | null = null;
  if (cfg.latencyQuery) {
    const lat = await integration.client.query(prometheusUid, cfg.latencyQuery);
    const val = extractScalarValue(lat);
    if (val !== null) latencyMs = Math.round(val * 1000);
  }

  let errorRate: number | null = null;
  if (cfg.errorQuery) {
    const err = await integration.client.query(prometheusUid, cfg.errorQuery);
    errorRate = extractScalarValue(err);
  }

  await prisma.serviceHealthSample.create({
    data: {
      entityId: cfg.entityId,
      status: deriveStatus(up, errorRate),
      latencyMs,
      errorRate,
    },
  });
}

async function scrapeOneIntegration(
  integration: GrafanaIntegrationRecord,
  signal: AbortSignal,
  log: { info(o: unknown, msg?: string): void; error?(o: unknown, msg?: string): void },
): Promise<{ integrationId: string; entitiesScraped: number; entityErrors: number }> {
  const promUid = integration.dsUid.prometheus;
  if (!promUid) {
    log.info(
      { integrationId: integration.id, name: integration.name },
      "Skipping integration — no Prometheus datasource UID configured",
    );
    return { integrationId: integration.id, entitiesScraped: 0, entityErrors: 0 };
  }

  const configs = await prisma.entityObservabilityConfig.findMany({
    where: { integrationId: integration.id, NOT: { upQuery: null } },
    select: { entityId: true, upQuery: true, latencyQuery: true, errorQuery: true },
  });

  let entitiesScraped = 0;
  let entityErrors = 0;

  for (let i = 0; i < configs.length; i += CHUNK_SIZE) {
    if (signal.aborted) break;
    const chunk = configs.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((cfg) => scrapeEntity(integration, promUid, cfg)),
    );
    for (const [idx, r] of results.entries()) {
      if (r.status === "fulfilled") {
        entitiesScraped += 1;
      } else {
        entityErrors += 1;
        log.error?.(
          {
            integrationId: integration.id,
            entityId: chunk[idx].entityId,
            err: r.reason instanceof Error ? r.reason.message : String(r.reason),
          },
          "Per-entity scrape failed",
        );
      }
    }
  }

  return { integrationId: integration.id, entitiesScraped, entityErrors };
}

export function prometheusScrapeJob(): ObservabilityJobDefinition {
  return {
    name: "observability.prometheus-scrape",
    schedule: "*/5 * * * *",
    timeoutMs: 4 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const integrations = await loadGrafanaIntegrations();
      if (integrations.length === 0) {
        log.info({}, "No enabled Grafana integrations — scrape no-op");
        return;
      }

      const settled = await Promise.allSettled(
        integrations.map((integration) => scrapeOneIntegration(integration, signal, log)),
      );

      let integrationsScraped = 0;
      let integrationErrors = 0;
      let entitiesScraped = 0;
      let entityErrors = 0;
      for (const [idx, result] of settled.entries()) {
        if (result.status === "fulfilled") {
          integrationsScraped += 1;
          entitiesScraped += result.value.entitiesScraped;
          entityErrors += result.value.entityErrors;
        } else {
          integrationErrors += 1;
          const integration = integrations[idx];
          const isAuthError =
            result.reason instanceof GrafanaApiError &&
            (result.reason.status === 401 || result.reason.status === 403);
          log.error?.(
            {
              integrationId: integration.id,
              name: integration.name,
              err: result.reason instanceof Error ? result.reason.message : String(result.reason),
              authError: isAuthError,
            },
            "Integration scrape failed",
          );
        }
      }

      log.info(
        { integrationsScraped, integrationErrors, entitiesScraped, entityErrors },
        "Prometheus scrape sweep complete",
      );
    },
  };
}
