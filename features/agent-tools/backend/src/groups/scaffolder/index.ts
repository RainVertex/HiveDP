import type { ToolGroup } from "../../types";
import {
  scaffolderListTemplatesTool,
  scaffolderPlanTool,
  scaffolderApplyPlanTool,
} from "./templates";

export const scaffolderGroup: ToolGroup = {
  meta: { id: "scaffolder", order: 90 },
  tools: [scaffolderListTemplatesTool, scaffolderPlanTool, scaffolderApplyPlanTool],
};
