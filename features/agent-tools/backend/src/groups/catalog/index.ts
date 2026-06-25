import type { ToolGroup } from "../../types";
import { search, getEntity, ownedByTeam } from "./entities";
import { lookup, discover } from "./enrich";

export const catalogGroup: ToolGroup = {
  meta: {
    id: "catalog",
    label: "Katalog",
    description: "Katalog varlıklarını arama, görüntüleme ve catalog-info.yaml keşfi.",
    order: 40,
  },
  tools: [search, getEntity, ownedByTeam, lookup, discover],
};
