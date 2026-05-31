// Loads Grafana integration rows, decrypts their token, and builds a GrafanaClient.
import { decryptSecret, prisma } from "@internal/db";
import { createGrafanaClient, type GrafanaClient } from "@internal/grafana-client";

export interface GrafanaIntegrationRecord {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  client: GrafanaClient;
  dsUid: { prometheus?: string; loki?: string; tempo?: string };
  imageRendererAvailable: boolean;
  webhookSecret: string | null;
  alertRefireSuppressionMs: number;
}

const DEFAULT_ALERT_REFIRE_SUPPRESSION_MS = 3_600_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readDsUid(value: unknown): GrafanaIntegrationRecord["dsUid"] {
  const raw = asRecord(value);
  const out: GrafanaIntegrationRecord["dsUid"] = {};
  if (typeof raw.prometheus === "string" && raw.prometheus) out.prometheus = raw.prometheus;
  if (typeof raw.loki === "string" && raw.loki) out.loki = raw.loki;
  if (typeof raw.tempo === "string" && raw.tempo) out.tempo = raw.tempo;
  return out;
}

function hydrate(row: {
  id: string;
  name: string;
  enabled: boolean;
  config: unknown;
}): GrafanaIntegrationRecord {
  const cfg = asRecord(row.config);
  const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
  const apiTokenEnc = typeof cfg.apiToken === "string" ? cfg.apiToken : "";
  if (!baseUrl || !apiTokenEnc) {
    throw new Error(
      `Grafana integration ${row.id} is missing baseUrl or apiToken in config — reconnect required.`,
    );
  }
  const apiToken = decryptSecret(apiTokenEnc);
  const client = createGrafanaClient({ baseUrl, apiToken });
  const webhookSecretEnc = typeof cfg.webhookSecret === "string" ? cfg.webhookSecret : null;
  const webhookSecret = webhookSecretEnc ? decryptSecret(webhookSecretEnc) : null;
  const suppression = cfg.alertRefireSuppressionMs;
  const alertRefireSuppressionMs =
    typeof suppression === "number" && Number.isFinite(suppression) && suppression >= 0
      ? Math.floor(suppression)
      : DEFAULT_ALERT_REFIRE_SUPPRESSION_MS;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    baseUrl,
    client,
    dsUid: readDsUid(cfg.dsUid),
    imageRendererAvailable: Boolean(cfg.imageRendererAvailable),
    webhookSecret,
    alertRefireSuppressionMs,
  };
}

// Load every enabled Grafana integration.
export async function loadGrafanaIntegrations(): Promise<GrafanaIntegrationRecord[]> {
  const rows = await prisma.integration.findMany({
    where: { kind: "grafana", enabled: true },
    select: { id: true, name: true, enabled: true, config: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(hydrate);
}

// Loads a Grafana integration by id regardless of enabled; callers must check record.enabled.
export async function loadGrafanaIntegrationById(
  id: string,
): Promise<GrafanaIntegrationRecord | null> {
  const row = await prisma.integration.findUnique({
    where: { id },
    select: { id: true, name: true, enabled: true, kind: true, config: true },
  });
  if (!row || row.kind !== "grafana") return null;
  return hydrate(row);
}

// Loads the canonical (most-recently-updated, enabled) integration for id-less routes.
export async function loadDefaultGrafanaIntegration(): Promise<GrafanaIntegrationRecord | null> {
  const row = await prisma.integration.findFirst({
    where: { kind: "grafana", enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, enabled: true, config: true },
  });
  if (!row) return null;
  return hydrate(row);
}
