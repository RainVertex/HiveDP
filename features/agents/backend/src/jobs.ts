// Scheduled agent cron jobs run by the API. The agent task queue itself is drained by the worker
// processes (see workerLoop), not by a cron tick, so a long run never blocks the scheduler.
import { syncModelPricing } from "./services/pricing";
import type { AgentJobDefinition } from "./jobTypes";

// Daily refresh of model rates from OpenRouter so costPer1k* is not hand-maintained.
export function modelPricingSyncJob(): AgentJobDefinition {
  return {
    name: "agents.modelPricingSync",
    schedule: "0 5 * * *",
    timeoutMs: 60_000,
    handler: async ({ log, signal }) => {
      const result = await syncModelPricing({ signal });
      log.info(result, "Model pricing sync complete");
    },
  };
}

export function getAgentJobs(): AgentJobDefinition[] {
  return [modelPricingSyncJob()];
}
