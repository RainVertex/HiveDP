import type { ToolGroup } from "../../types";
import { listMine, listForUser } from "./membership";
import { getTeam, listMembers } from "./directory";

export const teamsGroup: ToolGroup = {
  meta: { id: "teams", order: 20 },
  tools: [listMine, listForUser, getTeam, listMembers],
};
