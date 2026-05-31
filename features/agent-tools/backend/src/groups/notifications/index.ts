import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "../../types";
import { requireUserId } from "../core";

const myUnread: RegisteredTool = {
  id: "notifications_my_unread",
  openaiDef: {
    type: "function",
    function: {
      name: "notifications_my_unread",
      description:
        "List the current user's unread notifications. Returns up to 30 most recent. Each entry includes a kind and a small payload object describing what happened.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    const rows = await prisma.notification.findMany({
      where: { recipientUserId: userId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        payload: n.payload,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  },
};

export const notificationsGroup: ToolGroup = {
  meta: {
    id: "notifications",
    label: "Bildirimler",
    description: "Okunmamış bildirimler.",
    order: 60,
  },
  tools: [myUnread],
};
