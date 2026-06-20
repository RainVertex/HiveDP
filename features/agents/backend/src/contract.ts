// Public cross-feature contract. Other feature backends import from "@feature/agents-backend/contract".
// Keep this surface small and intentional. The main barrel (./index) is for the api shell only.
export { runAgent } from "./index";
// Skill resolution is exported from the lightweight "./skills" subpath so chat can consume it without
// pulling the executor graph that runAgent (re-exported above from ./index) drags in.

// Generic agent task queue: features enqueue work and register a handler for their kind.
export { enqueueAgentTask, type EnqueueAgentTaskInput } from "./services/agentTasks";
export {
  registerAgentTaskHandler,
  type AgentTaskHandler,
  type AgentTaskOutcome,
} from "./services/agentTaskHandlers";
