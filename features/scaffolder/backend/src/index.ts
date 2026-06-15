/** Public surface of the scaffolder backend feature. */
export { applyPlan, PlanExpiredError } from "./services/apply";
export {
  acquireTargetLock,
  ensurePlanFresh,
  lockKeyForTarget,
  TargetLockBusyError,
  StalePlanError,
} from "./services/locks";
export { taskEventBus } from "./services/events";
export {
  getActionRegistry,
  getTemplates,
  invalidateTemplateCache,
  resetRegistries,
} from "./services/registry";
export {
  validateTemplateSource,
  wizardSchemaFromYaml,
  yamlTemplateSchema,
  type YamlTemplate,
} from "./services/template-defs";
export { buildPlanCtx } from "./services/plan-ctx";
export { actorFromRequest } from "./services/actor";
export { getScaffolderTools } from "./services/agent-tools";
export {
  mintMcpToken,
  verifyMcpToken,
  listMcpTokensForUser,
  listAllMcpTokens,
  revokeMcpToken,
} from "./services/mcp-tokens";
export { createScaffolderRouter } from "./routes";
export { createScaffolderMcpRouter } from "./mcp";
export {
  getScaffolderJobs,
  runBootDriftCheck,
  driftSweepJob,
  workspaceGcJob,
  type ScaffolderJobDefinition,
  type ScaffolderJobsConfig,
} from "./jobs";
export { runDriftSweep, reconcileTemplateHashSnapshots } from "./services/drift";
export { seedTemplateAcls, EVERYONE_SUBJECT_ID } from "./services/bootstrap-acl";
export { seedDefaultTemplates } from "./services/bootstrap-default-templates";
export { filterByTemplateAcl } from "./services/acl";
export {
  discoverCatalogYaml,
  discoverAndPersist,
  parseGithubUrl,
  type DiscoveryInput,
  type DiscoveryResult,
  type DiscoverAndPersistResult,
} from "./services/catalog-discovery";

import type { FeatureManifestSource } from "@internal/feature-host";
import { createScaffolderRouter as createScaffolderRouterForManifest } from "./routes";
import { createScaffolderMcpRouter as createScaffolderMcpRouterForManifest } from "./mcp";

export const featureManifest: FeatureManifestSource = () => ({
  mounts: [
    {
      path: "/mcp/scaffolder",
      router: createScaffolderMcpRouterForManifest(),
      phase: "preApi",
    },
    {
      path: "/api/scaffolder",
      router: createScaffolderRouterForManifest(),
    },
  ],
});
