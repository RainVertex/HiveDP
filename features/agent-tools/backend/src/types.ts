import type { RegisteredTool, ToolGroupMeta } from "@internal/llm-core";

// One skill: display metadata plus the tools that belong to it. A group whose enabled() returns
// false registers its meta (so the skill id stays known) but not its tools (so it resolves to none).
export interface ToolGroup {
  meta: ToolGroupMeta;
  tools: RegisteredTool[];
  enabled?: () => boolean;
}
