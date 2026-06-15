// Public barrel for @feature/agents-backend: re-exports plus the feature manifest. The CRUD and
// registry implementation lives under routes/controllers/services/repositories.
import type { FeatureManifest } from "@internal/feature-host";
import { agentsRouter } from "./routes/agents";
import { llmRouter } from "./routes/llm";
import { skillsRouter } from "./routes/skills";

export { agentsRouter, llmRouter, skillsRouter };

export {
  runAgent,
  startAgentRun,
  cancelAgentRun,
  reconcileStaleAgentRuns,
  type RunAgentInput,
  type RunAgentResult,
  type RunAgentToolCall,
  type RunAgentStep,
} from "./executor";
export {
  catalogEnricherJob,
  getAgentJobs,
  type AgentJobDefinition,
  type AgentJobContext,
} from "./jobs";
export {
  registerTools,
  resolveTools,
  type RegisteredTool,
  type ToolContext,
} from "@internal/llm-core";

export const featureManifest: FeatureManifest = {
  mounts: [
    { path: "/api/agents", router: agentsRouter },
    { path: "/api/llm", router: llmRouter },
    { path: "/api/skills", router: skillsRouter },
  ],
};
