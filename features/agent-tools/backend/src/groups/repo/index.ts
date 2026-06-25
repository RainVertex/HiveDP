import type { ToolGroup } from "../../types";
import { repoInfoTool, repoSearchTool, repoListDirTool, repoReadFileTool } from "./reads";
import { openYamlPr } from "./pr";

export const repoGroup: ToolGroup = {
  meta: {
    id: "repo",
    label: "Depo",
    description:
      "Bağlı depoları (platform, proje veya katalog varlığı) okuma ve catalog-info.yaml için PR açma.",
    order: 60,
  },
  tools: [repoInfoTool, repoSearchTool, repoListDirTool, repoReadFileTool, openYamlPr],
};
