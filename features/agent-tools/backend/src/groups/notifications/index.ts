import type { ToolGroup } from "../../types";
import { myUnread } from "./unread";

export const notificationsGroup: ToolGroup = {
  meta: { id: "notifications", order: 70 },
  tools: [myUnread],
};
