// Daily cleanup of stale AlertDeliveryState rows so the dedup table cannot grow unbounded.
// The explicit firing-only branch is load-bearing: `{ lt }` on a nullable column drops NULLs, so unique-fingerprint spam would otherwise never be reaped.

import { prisma } from "@internal/db";
import type { ObservabilityJobDefinition } from "./types";

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function alertStateCleanupJob(): ObservabilityJobDefinition {
  return {
    name: "observability.alert-state-cleanup",
    schedule: "0 3 * * *",
    timeoutMs: 60_000,
    handler: async ({ log }) => {
      const cutoff = new Date(Date.now() - STALE_AFTER_MS);
      const result = await prisma.alertDeliveryState.deleteMany({
        where: {
          OR: [
            {
              AND: [
                { lastResolvedAt: { lt: cutoff } },
                { OR: [{ lastFiringAt: null }, { lastFiringAt: { lt: cutoff } }] },
              ],
            },
            // Firing-only fingerprint never resolved (flapper or fingerprint spam).
            { AND: [{ lastResolvedAt: null }, { lastFiringAt: { lt: cutoff } }] },
            // Both null is anomalous, so fall back to updatedAt.
            {
              AND: [
                { lastResolvedAt: null },
                { lastFiringAt: null },
                { updatedAt: { lt: cutoff } },
              ],
            },
          ],
        },
      });
      log.info({ deleted: result.count, cutoff: cutoff.toISOString() }, "Alert state cleanup");
    },
  };
}
