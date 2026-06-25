import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "./context";
import { getUserIdentity } from "./queries";

// Bootstrapping tools (whoami, get_today) every conversation should call once. Their ids are
// intentionally unprefixed: they are global primitives, unlike the <group>_ prefix used elsewhere.

export const whoami: RegisteredTool = {
  id: "whoami",
  openaiDef: {
    type: "function",
    function: {
      name: "whoami",
      description:
        "Identify the current user. Returns name, email, role, team memberships, and department memberships. Call once at the start of a conversation.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    const identity = await getUserIdentity(userId);
    if (!identity) return { error: "User not found" };
    return { ...identity, isAdmin: ctx.isAdmin };
  },
};

export const getToday: RegisteredTool = {
  id: "get_today",
  openaiDef: {
    type: "function",
    function: {
      name: "get_today",
      description:
        "Return today's date in ISO format (YYYY-MM-DD) along with the current weekday and ISO timestamp in UTC. Call this before answering any question that needs the current date.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async () => {
    const now = new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    return { date, weekday, isoTimestamp: iso };
  },
};
