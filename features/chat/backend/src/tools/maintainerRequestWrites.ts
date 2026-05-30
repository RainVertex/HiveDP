import type { RegisteredTool } from "@internal/llm-core";

// Maintainer-request write tools (approve / reject) deferred past v1: the
// underlying handlers in features/teams/backend/src/maintainerRequests.ts
// are still inline route bodies that take the express Request directly for
// audit + auth. Wrapping them through the chat boundary requires the same
// extract-into-service-function pattern we did for createTeamRequest. Once
// that refactor lands, drop the prepare/submit pair in here and add the
// ids to platformAssistantToolIds().
//
// For v1 the assistant gracefully tells the user to perform these actions
// in the UI when asked.

export const MAINTAINER_REQUEST_WRITE_TOOLS: RegisteredTool[] = [];
export const MAINTAINER_REQUEST_WRITE_TOOL_IDS: string[] = MAINTAINER_REQUEST_WRITE_TOOLS.map(
  (t) => t.id,
);
