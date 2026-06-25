import type { ToolGroup } from "../../types";
import { repoInfoTool, repoSearchTool, repoListDirTool, repoReadFileTool } from "./reads";
import { openYamlPr } from "./pr";

export const repoGroup: ToolGroup = {
  meta: { id: "repo", order: 60 },
  tools: [repoInfoTool, repoSearchTool, repoListDirTool, repoReadFileTool, openYamlPr],
};
