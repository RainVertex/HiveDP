import type { RegisteredTool, ToolGroupMeta } from "@internal/llm-core";

// One category of tools: display metadata plus the tools that belong to it.
export interface ToolGroup {
  meta: ToolGroupMeta;
  tools: RegisteredTool[];
}
