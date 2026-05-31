// Webhook delivery: signing, HTTP dispatch, retry/backoff scheduling, and due-row queries.
import { createHmac, randomBytes } from "node:crypto";
import { Prisma, prisma } from "@internal/db";

// Retry delays in ms, indexed by zero-based attempt count after the first failure.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

interface SlackPayload {
  text: string;
  blocks?: unknown[];
}

function isSlackUrl(url: string): boolean {
  try {
    return new URL(url).host === "hooks.slack.com";
  } catch {
    return false;
  }
}

function asSlackPayload(eventKind: string, payload: Record<string, unknown>): SlackPayload {
  // Slack's plain-JSON shape stays parseable by native receivers too.
  return {
    text: `[${eventKind}] ${JSON.stringify(payload)}`,
  };
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export async function attemptDelivery(
  deliveryId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "succeeded" | "failed" | "dead"; httpStatus?: number }> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { subscription: true },
  });
  if (!delivery) return { status: "failed" };
  if (!delivery.subscription.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "dead", lastError: "subscription inactive" },
    });
    return { status: "dead" };
  }

  const rawPayload = (delivery.payload as Record<string, unknown>) ?? {};
  const body = JSON.stringify(
    isSlackUrl(delivery.subscription.url)
      ? asSlackPayload(delivery.eventKind, rawPayload)
      : { eventKind: delivery.eventKind, payload: rawPayload, deliveryId: delivery.id },
  );
  const signature = signBody(delivery.subscription.secret, body);
  const now = new Date();
  const nextAttemptCount = delivery.attemptCount + 1;

  try {
    const res = await fetchImpl(delivery.subscription.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mep-signature": signature,
        "x-mep-event-kind": delivery.eventKind,
        "x-mep-delivery-id": delivery.id,
      },
      body,
    });

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "succeeded",
          attemptCount: nextAttemptCount,
          lastAttemptAt: now,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      return { status: "succeeded", httpStatus: res.status };
    }

    return await markFailureOrDead(delivery.id, nextAttemptCount, now, `HTTP ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await markFailureOrDead(delivery.id, nextAttemptCount, now, message);
  }
}

async function markFailureOrDead(
  deliveryId: string,
  nextAttemptCount: number,
  now: Date,
  errorMessage: string,
): Promise<{ status: "failed" | "dead" }> {
  if (nextAttemptCount >= MAX_ATTEMPTS) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "dead",
        attemptCount: nextAttemptCount,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastError: errorMessage.slice(0, 1000),
      },
    });
    return { status: "dead" };
  }

  const delayMs = RETRY_DELAYS_MS[nextAttemptCount - 1] ?? RETRY_DELAYS_MS.at(-1)!;
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "failed",
      attemptCount: nextAttemptCount,
      lastAttemptAt: now,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      lastError: errorMessage.slice(0, 1000),
    },
  });
  return { status: "failed" };
}

export async function findDueDeliveryIds(now: Date, limit = 50): Promise<string[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export async function enqueuePing(
  subscriptionId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const row = await prisma.webhookDelivery.create({
    data: {
      subscriptionId,
      eventKind: "webhook.ping",
      payload: payload as Prisma.InputJsonValue,
      status: "pending",
      nextAttemptAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}
