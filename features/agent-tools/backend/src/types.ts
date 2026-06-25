import type { RegisteredTool, ToolGroupMeta } from "@internal/llm-core";

// A tool group: its identity/sort metadata plus the tools that belong to it.
export interface ToolGroup {
  meta: ToolGroupMeta;
  tools: RegisteredTool[];
}
