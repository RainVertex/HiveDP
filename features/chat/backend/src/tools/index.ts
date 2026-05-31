import { registerTools, type RegisteredTool } from "@internal/llm-core";
import { CHAT_CORE_TOOLS, CHAT_CORE_TOOL_IDS } from "./core";
import { TEAMS_READ_TOOLS, TEAMS_READ_TOOL_IDS } from "./teams";
import { REQUESTS_READ_TOOLS, REQUESTS_READ_TOOL_IDS } from "./requests";
import { CATALOG_READ_TOOLS, CATALOG_READ_TOOL_IDS } from "./catalog";
import { ORG_READ_TOOLS, ORG_READ_TOOL_IDS } from "./org";
import { NOTIFICATIONS_READ_TOOLS, NOTIFICATIONS_READ_TOOL_IDS } from "./notifications";
import { INTEGRATIONS_READ_TOOLS, INTEGRATIONS_READ_TOOL_IDS } from "./integrations";
import { TEAM_REQUEST_WRITE_TOOLS, TEAM_REQUEST_WRITE_TOOL_IDS } from "./teamRequestWrites";
import {
  MAINTAINER_REQUEST_WRITE_TOOLS,
  MAINTAINER_REQUEST_WRITE_TOOL_IDS,
} from "./maintainerRequestWrites";

// Aggregator registering chat tools so resolveTools() finds them when the Platform Assistant agent boots.
// Write tools register only when CHAT_WRITE_TOOLS_ENABLED is unset or "true" (flip off if write quality is poor).

export const CHAT_READ_TOOLS: RegisteredTool[] = [
  ...CHAT_CORE_TOOLS,
  ...TEAMS_READ_TOOLS,
  ...REQUESTS_READ_TOOLS,
  ...CATALOG_READ_TOOLS,
  ...ORG_READ_TOOLS,
  ...NOTIFICATIONS_READ_TOOLS,
  ...INTEGRATIONS_READ_TOOLS,
];

export const CHAT_READ_TOOL_IDS: string[] = [
  ...CHAT_CORE_TOOL_IDS,
  ...TEAMS_READ_TOOL_IDS,
  ...REQUESTS_READ_TOOL_IDS,
  ...CATALOG_READ_TOOL_IDS,
  ...ORG_READ_TOOL_IDS,
  ...NOTIFICATIONS_READ_TOOL_IDS,
  ...INTEGRATIONS_READ_TOOL_IDS,
];

export const CHAT_WRITE_TOOLS: RegisteredTool[] = [
  ...TEAM_REQUEST_WRITE_TOOLS,
  ...MAINTAINER_REQUEST_WRITE_TOOLS,
];

export const CHAT_WRITE_TOOL_IDS: string[] = [
  ...TEAM_REQUEST_WRITE_TOOL_IDS,
  ...MAINTAINER_REQUEST_WRITE_TOOL_IDS,
];

export function platformAssistantToolIds(): string[] {
  const writesEnabled = process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";
  return writesEnabled ? [...CHAT_READ_TOOL_IDS, ...CHAT_WRITE_TOOL_IDS] : [...CHAT_READ_TOOL_IDS];
}

export function registerChatTools(): void {
  const writesEnabled = process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";
  registerTools(CHAT_READ_TOOLS);
  if (writesEnabled) registerTools(CHAT_WRITE_TOOLS);
}
