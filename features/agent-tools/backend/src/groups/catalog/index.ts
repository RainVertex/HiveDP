import type { ToolGroup } from "../../types";
import { search, getEntity, ownedByTeam } from "./entities";
import { lookup, discover } from "./enrich";

export const catalogGroup: ToolGroup = {
  meta: { id: "catalog", order: 30 },
  tools: [search, getEntity, ownedByTeam, lookup, discover],
};
