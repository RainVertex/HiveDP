import { registerTools, registerToolGroups, type RegisteredTool } from "@internal/llm-core";
import { TEAM_REQUEST_WRITE_TOOLS } from "./teamRequestWrites";
import { MAINTAINER_REQUEST_WRITE_TOOLS } from "./maintainerRequestWrites";

// The chat write skill stays here because its tools need chat conversation context (the prepare/submit
// preview flow). Read skills live in @feature/agent-tools-backend. Writes register only when
// CHAT_WRITE_TOOLS_ENABLED is unset or "true", so the skill resolves to no tools while disabled.

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

function writesEnabled(): boolean {
  return process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";
}

export function registerChatWriteTools(): void {
  // Register the meta unconditionally so "team-requests-write" stays a known skill even when writes
  // are disabled (resolveSkills then expands it to no tools instead of rejecting an unknown skill).
  registerToolGroups([WRITE_GROUP]);
  if (!writesEnabled()) return;
  registerTools(CHAT_WRITE_TOOLS);
}
