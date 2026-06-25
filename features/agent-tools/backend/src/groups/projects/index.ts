import type { ToolGroup } from "../../types";
import {
  createSubtaskTool,
  listSubtasksTool,
  getTaskTool,
  assignTaskTool,
  createTaskTool,
  moveTaskTool,
  searchTasksTool,
  listMyTasksTool,
} from "./tasks";
import { commentOnTaskTool } from "./comments";
import { listLabelsTool, setLabelsTool } from "./labels";

export const projectsGroup: ToolGroup = {
  meta: { id: "projects", order: 50 },
  tools: [
    createSubtaskTool,
    listSubtasksTool,
    getTaskTool,
    assignTaskTool,
    createTaskTool,
    moveTaskTool,
    searchTasksTool,
    listMyTasksTool,
    commentOnTaskTool,
    listLabelsTool,
    setLabelsTool,
  ],
};
