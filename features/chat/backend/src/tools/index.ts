import { registerTools, registerToolGroups, type RegisteredTool } from "@internal/llm-core";
import { TEAM_REQUEST_WRITE_TOOLS, TEAM_REQUEST_WRITE_TOOL_IDS } from "./teamRequestWrites";
import {
  MAINTAINER_REQUEST_WRITE_TOOLS,
  MAINTAINER_REQUEST_WRITE_TOOL_IDS,
} from "./maintainerRequestWrites";

// Chat write tools stay here because they need chat conversation context (the prepare/submit preview flow).
// Read tools live in @feature/agent-tools-backend. Writes register only when CHAT_WRITE_TOOLS_ENABLED is unset or "true".

const WRITE_GROUP = {
  id: "team-requests-write",
  label: "Takım istekleri (yazma)",
  description: "Takım oluşturma isteği hazırlama ve gönderme.",
  order: 80,
};

export const CHAT_WRITE_TOOLS: RegisteredTool[] = [
  ...TEAM_REQUEST_WRITE_TOOLS,
  ...MAINTAINER_REQUEST_WRITE_TOOLS,
].map((t) => ({ ...t, group: WRITE_GROUP.id }));

export const CHAT_WRITE_TOOL_IDS: string[] = [
  ...TEAM_REQUEST_WRITE_TOOL_IDS,
  ...MAINTAINER_REQUEST_WRITE_TOOL_IDS,
];

function writesEnabled(): boolean {
  return process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";
}

export function chatWriteToolIds(): string[] {
  return writesEnabled() ? [...CHAT_WRITE_TOOL_IDS] : [];
}

export function registerChatWriteTools(): void {
  if (!writesEnabled()) return;
  registerToolGroups([WRITE_GROUP]);
  registerTools(CHAT_WRITE_TOOLS);
}
