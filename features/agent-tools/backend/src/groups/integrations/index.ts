import type { ToolGroup } from "../../types";
import { listGithub } from "./github";

export const integrationsGroup: ToolGroup = {
  meta: { id: "integrations", order: 80 },
  tools: [listGithub],
};
