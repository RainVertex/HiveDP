import type { ToolGroup } from "../../types";
import { listDepartments, getDepartment } from "./departments";

export const orgGroup: ToolGroup = {
  meta: { id: "org", order: 40 },
  tools: [listDepartments, getDepartment],
};
