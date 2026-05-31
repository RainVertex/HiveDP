// Cron sweep that backfills pipeline data the webhook path missed; per-entity progress lives in PipelineSyncCursor rows.

import type { CatalogJobDefinition } from "../jobs";
import { syncAllPipelines } from "./sync";

export function pipelinesSyncJob(): CatalogJobDefinition {
  return {
    name: "catalog.pipelinesSync",
    schedule: "*/15 * * * *",
    timeoutMs: 10 * 60 * 1000,
    handler: async ({ log }) => {
      const result = await syncAllPipelines();
      log.info(result, "Pipelines sync sweep complete");
    },
  };
}
