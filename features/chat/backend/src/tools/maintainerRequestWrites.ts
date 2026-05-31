import type { RegisteredTool } from "@internal/llm-core";

// Empty for v1: maintainer approve/reject handlers must first be extracted into service functions before wrapping through the chat boundary.

export const MAINTAINER_REQUEST_WRITE_TOOLS: RegisteredTool[] = [];
export const MAINTAINER_REQUEST_WRITE_TOOL_IDS: string[] = MAINTAINER_REQUEST_WRITE_TOOLS.map(
  (t) => t.id,
);
