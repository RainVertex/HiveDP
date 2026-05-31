// Scheduled job definitions that periodically retry due webhook deliveries.
import { attemptDelivery, findDueDeliveryIds } from "./delivery";
import { prisma } from "@internal/db";

export interface WebhookJobLogger {
  info(o: unknown, msg?: string): void;
}

export interface WebhookJobContext {
  log: WebhookJobLogger;
  signal: AbortSignal;
}

export interface WebhookJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: WebhookJobContext) => Promise<void>;
}

// Drains pending and due-failed deliveries on each run.
export function webhookDeliveryRetryJob(): WebhookJobDefinition {
  return {
    name: "webhooks.deliveryRetry",
    schedule: "*/5 * * * *",
    timeoutMs: 4 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const ids = await findDueDeliveryIds(new Date(), 100);
      let succeeded = 0;
      let failed = 0;
      let dead = 0;

      for (const id of ids) {
        if (signal.aborted) break;
        const result = await attemptDelivery(id);
        if (result.status === "succeeded") succeeded++;
        else if (result.status === "dead") {
          dead++;
          const delivery = await prisma.webhookDelivery.findUnique({
            where: { id },
            select: {
              id: true,
              subscriptionId: true,
              eventKind: true,
              attemptCount: true,
            },
          });
          if (delivery) {
            await prisma.auditEvent.create({
              data: {
                kind: "webhook.delivery.failed",
                targetKind: "webhookDelivery",
                targetId: delivery.id,
                payload: {
                  subscriptionId: delivery.subscriptionId,
                  deliveryId: delivery.id,
                  eventKind: delivery.eventKind,
                  attemptCount: delivery.attemptCount,
                },
              },
            });
          }
        } else {
          failed++;
        }
      }

      log.info(
        { processed: ids.length, succeeded, failed, dead },
        "Webhook delivery retry sweep complete",
      );
    },
  };
}

export function getWebhookJobs(): WebhookJobDefinition[] {
  return [webhookDeliveryRetryJob()];
}
