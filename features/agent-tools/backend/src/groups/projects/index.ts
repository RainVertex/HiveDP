import type { ToolGroup } from "../../types";
import { createSubtaskTool, listSubtasksTool, getTaskTool, assignTaskTool } from "./tasks";

export const projectsGroup: ToolGroup = {
  meta: {
    id: "projects",
    label: "Projeler",
    description: "Proje görevlerini alt görevlere bölme ve görüntüleme.",
    order: 50,
  },
  tools: [createSubtaskTool, listSubtasksTool, getTaskTool, assignTaskTool],
};
