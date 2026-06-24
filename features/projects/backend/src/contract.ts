// Public cross-feature contract. Other feature backends import from "@feature/projects-backend/contract".
// Keep this surface small and intentional. The main barrel (./index) is for the api shell only.
export {
  provisionProjectsForInstallation,
  provisionProjectForEntity,
  archiveProjectByGithubRepoId,
  reconcileProjectMembersForInstallation,
} from "./index";

export { createSubtask, listSubtasks, getTask } from "./services/tasks";
export { assignUserToTask, searchAssignableUsers } from "./services/assignees";
export { getProjectRepoRef } from "./services/repo";
