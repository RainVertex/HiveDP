// Grafana Alertmanager webhook receiver: per-integration bearer auth, replay guard, dedup, fan-out.
// MUST be mounted with express.raw() BEFORE express.json() (same as the GitHub webhook receiver).
import { Router } from "express";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { decryptSecret, prisma, Prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend/contract";

const ALERT_MAX_AGE_MS = 600_000;
const DEFAULT_ALERT_REFIRE_SUPPRESSION_MS = 3_600_000;

type AlertStatus = "firing" | "resolved";

interface AlertmanagerAlert {
  status?: AlertStatus | string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
}

interface AlertmanagerPayload {
  alerts?: AlertmanagerAlert[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function parseBearer(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m ? m[1].trim() : null;
}

async function resolveRecipients(
  alert: AlertmanagerAlert,
): Promise<{ recipientUserIds: string[]; teamId: string | null }> {
  const labels = alert.labels ?? {};

  // 1. Entity owners -> members of every owning team.
  const entityName = labels.entity;
  if (entityName) {
    const entity = await prisma.catalogEntity.findFirst({
      where: { name: entityName },
      select: {
        owners: {
          select: {
            team: { select: { id: true, memberships: { select: { userId: true } } } },
          },
        },
      },
    });
    if (entity) {
      const userIds = new Set<string>();
      for (const owner of entity.owners) {
        for (const m of owner.team.memberships) userIds.add(m.userId);
      }
      if (userIds.size > 0) {
        const firstTeamId = entity.owners[0]?.team.id ?? null;
        return { recipientUserIds: [...userIds], teamId: firstTeamId };
      }
    }
  }

  // 2. labels.team -> Team.slug
  const teamSlug = labels.team;
  if (teamSlug) {
    const team = await prisma.team.findFirst({
      where: { slug: teamSlug, deletedAt: null },
      select: { id: true, memberships: { select: { userId: true } } },
    });
    if (team && team.memberships.length > 0) {
      return {
        recipientUserIds: team.memberships.map((m) => m.userId),
        teamId: team.id,
      };
    }
  }

  // 3. Fall back to all org admins.
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true },
  });
  return { recipientUserIds: admins.map((a) => a.id), teamId: null };
}

// Mounted outside /api/* so the global apiLimiter does not apply; cap per (integrationId, IP).
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: (req) => `${req.params.integrationId ?? "_"}|${ipKeyGenerator(req.ip ?? "")}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many alert deliveries; backing off." },
});

export const grafanaWebhookRouter: Router = Router();

grafanaWebhookRouter.use(webhookLimiter);

grafanaWebhookRouter.post(
  "/:integrationId",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    const integrationId = req.params.integrationId;
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, kind: true, enabled: true, config: true },
    });
    if (!integration || integration.kind !== "grafana") {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    if (!integration.enabled) {
      // 200 so Grafana doesn't retry indefinitely while intentionally disabled.
      res.status(200).json({ status: "ignored", reason: "integration disabled" });
      return;
    }

    const cfg = asRecord(integration.config);
    const webhookSecretEnc = typeof cfg.webhookSecret === "string" ? cfg.webhookSecret : "";
    if (!webhookSecretEnc) {
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }
    const webhookSecret = decryptSecret(webhookSecretEnc);
    const bearer = parseBearer(req.headers.authorization);
    if (!bearer || !constantTimeStringEqual(bearer, webhookSecret)) {
      res.status(401).json({ error: "Bad bearer" });
      return;
    }

    const rawBody: Buffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body ?? "");
    let payload: AlertmanagerPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as AlertmanagerPayload;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    if (alerts.length === 0) {
      res.status(200).json({ status: "ok", delivered: 0 });
      return;
    }

    // Replay protection: reject the whole batch, partial acceptance is hard to reason about.
    let maxStartsAt = -Infinity;
    for (const a of alerts) {
      if (a.startsAt) {
        const ts = Date.parse(a.startsAt);
        if (Number.isFinite(ts) && ts > maxStartsAt) maxStartsAt = ts;
      }
    }
    if (maxStartsAt !== -Infinity && Date.now() - maxStartsAt > ALERT_MAX_AGE_MS) {
      res.status(400).json({ error: "All alerts in batch are older than the max age window" });
      return;
    }

    const suppressionRaw = cfg.alertRefireSuppressionMs;
    const suppression =
      typeof suppressionRaw === "number" && Number.isFinite(suppressionRaw) && suppressionRaw >= 0
        ? Math.floor(suppressionRaw)
        : DEFAULT_ALERT_REFIRE_SUPPRESSION_MS;

    let delivered = 0;
    let suppressed = 0;
    let resolvedCount = 0;
    const now = new Date();

    for (const alert of alerts) {
      const status: AlertStatus = alert.status === "resolved" ? "resolved" : "firing";
      const fingerprint = alert.fingerprint;
      if (!fingerprint) {
        // Without a fingerprint we can't dedup; Grafana always sends one.
        continue;
      }

      const existing = await prisma.alertDeliveryState.findUnique({
        where: { integrationId_fingerprint: { integrationId, fingerprint } },
        select: { lastFiringAt: true },
      });

      let shouldNotify: boolean;
      let updateData: Prisma.AlertDeliveryStateUncheckedUpdateInput;
      let createData: Prisma.AlertDeliveryStateUncheckedCreateInput;

      if (status === "firing") {
        const withinWindow =
          existing?.lastFiringAt && now.getTime() - existing.lastFiringAt.getTime() < suppression;
        if (withinWindow) {
          // Bump updatedAt only; touching lastFiringAt would extend the suppression window on every repeat.
          shouldNotify = false;
          updateData = { updatedAt: now };
          createData = {
            integrationId,
            fingerprint,
            lastFiringAt: now,
          };
        } else {
          shouldNotify = true;
          updateData = { lastFiringAt: now };
          createData = {
            integrationId,
            fingerprint,
            lastFiringAt: now,
          };
        }
      } else {
        shouldNotify = true;
        // CRITICAL: clear lastFiringAt so the next firing isn't suppressed against a stale timestamp.
        updateData = { lastResolvedAt: now, lastFiringAt: null };
        createData = {
          integrationId,
          fingerprint,
          lastResolvedAt: now,
        };
      }

      await prisma.alertDeliveryState.upsert({
        where: { integrationId_fingerprint: { integrationId, fingerprint } },
        create: createData,
        update: updateData,
      });

      if (!shouldNotify) {
        suppressed += 1;
        continue;
      }

      const { recipientUserIds, teamId } = await resolveRecipients(alert);
      if (recipientUserIds.length === 0) continue;

      const kind = status === "resolved" ? "grafana.alert.resolved" : "grafana.alert";
      const labels = alert.labels ?? {};
      const annotations = alert.annotations ?? {};
      const payloadOut = {
        status,
        alertname: labels.alertname ?? "",
        summary: annotations.summary ?? annotations.description ?? "",
        severity: labels.severity ?? "",
        entity: labels.entity ?? "",
        startsAt: alert.startsAt ?? "",
        endsAt: alert.endsAt ?? "",
        generatorURL: alert.generatorURL ?? "",
        fingerprint,
      };

      // One transaction per recipient since notify() fans out webhook deliveries inside a tx.
      for (const recipientUserId of recipientUserIds) {
        await prisma.$transaction(async (tx) => {
          await notify(tx, {
            recipientUserId,
            kind,
            payload: payloadOut,
            teamId,
          });
        });
        delivered += 1;
      }

      if (status === "resolved") resolvedCount += 1;
    }

    res.status(200).json({ status: "ok", delivered, suppressed, resolved: resolvedCount });
  },
);
