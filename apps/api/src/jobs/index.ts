// Central cron registry: collects each feature's job definitions and re-exports scheduler controls.
import { resolve } from "node:path";
import { getScaffolderJobs } from "@feature/scaffolder-backend";
import { getAgentJobs } from "@feature/agents-backend";
import { getCatalogJobs } from "@feature/catalog-backend";
import { getObservabilityJobs } from "@feature/observability-backend";
import { getTeamJobs } from "@feature/teams-backend";
import { getWebhookJobs } from "@feature/webhooks-backend";
import { registerJob } from "./registry";
import { heartbeatJob } from "./heartbeat";

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registerJob(heartbeatJob);
  // Features export their jobs so apps/api stays the single owner of the cron registry.
  const liveRepoRoot = resolve(__dirname, "../../../..");
  for (const def of getScaffolderJobs({ liveRepoRoot })) {
    registerJob(def);
  }
  for (const def of getAgentJobs()) {
    registerJob(def);
  }
  for (const def of getCatalogJobs()) {
    registerJob(def);
  }
  for (const def of getObservabilityJobs()) {
    registerJob(def);
  }
  for (const def of getTeamJobs()) {
    registerJob(def);
  }
  for (const def of getWebhookJobs()) {
    registerJob(def);
  }
  registered = true;
}

export { startScheduler, stopScheduler } from "./scheduler";
export {
  runJob,
  listJobs,
  getJob,
  cancelOrphanedRuns,
  abortAll,
  waitForInFlight,
  getInFlightCount,
} from "./registry";
