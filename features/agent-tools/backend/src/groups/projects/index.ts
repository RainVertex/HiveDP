import type { ToolGroup } from "../../types";
import { createSubtaskTool, listSubtasksTool, getTaskTool, assignTaskTool } from "./tasks";
import {
  projectRepoInfo,
  projectRepoSearch,
  projectRepoListDir,
  projectRepoReadFile,
} from "./repoTools";

export const projectsGroup: ToolGroup = {
  meta: {
    id: "projects",
    label: "Projeler",
    description: "Proje görevlerini alt görevlere bölme, görüntüleme ve bağlı depoyu okuma.",
    order: 50,
  },
  tools: [
    createSubtaskTool,
    listSubtasksTool,
    getTaskTool,
    assignTaskTool,
    projectRepoInfo,
    projectRepoSearch,
    projectRepoListDir,
    projectRepoReadFile,
  ],
};
