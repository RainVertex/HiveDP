export { projectsRouter } from "./router";
export {
  getProjectsJobs,
  dueSoonReminderJob,
  type ProjectsJobContext,
  type ProjectsJobDefinition,
  type ProjectsJobLogger,
} from "./jobs";
export {
  provisionProjectForEntity,
  provisionProjectsForInstallation,
  reconcileProjectMembersForInstallation,
  archiveProjectByGithubRepoId,
  unarchiveProjectByGithubRepoId,
} from "./services/github-provisioning";
export { registerProjectAgentTaskHandlers } from "./services/agentRuns";

import type { FeatureManifest } from "@internal/feature-host";
import { projectsRouter as projectsRouterForManifest } from "./router";

export const featureManifest: FeatureManifest = {
  mounts: [{ path: "/api/projects", router: projectsRouterForManifest }],
};
