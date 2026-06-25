import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "../core";
import { listTeamsForUser, resolveUser } from "./queries";

export const listMine: RegisteredTool = {
  id: "teams_list_mine",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_list_mine",
      description:
        "List all teams the current user is a member of. Returns slug, name, description, and the user's role (lead or member) for each.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    return { teams: await listTeamsForUser(userId) };
  },
};

export const listForUser: RegisteredTool = {
  id: "teams_list_for_user",
  openaiDef: {
    type: "function",
    function: {
      name: "teams_list_for_user",
      description:
        "List all teams that another user (not the caller) is a member of, identified by their username (GitHub login), email, or display name. Returns the resolved user plus each team's slug, name, description, and that user's role. If the identifier matches more than one person, returns a `candidates` list to disambiguate. For the current user, use teams_list_mine instead.",
      parameters: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The target user's GitHub login (username), email, or display name.",
          },
        },
        required: ["username"],
      },
    },
  },
  handler: async (args, ctx) => {
    requireUserId(ctx);
    const q = String((args as { username?: string }).username ?? "").trim();
    if (!q) return { error: "username is required", code: "bad_args" };

    const resolved = await resolveUser(q);
    if (resolved.kind === "none") return { error: `No user found matching '${q}'.` };
    if (resolved.kind === "many") return { candidates: resolved.candidates };

    const { user } = resolved;
    return {
      user: {
        id: user.id,
        username: user.githubLogin,
        displayName: user.displayName,
        email: user.email,
      },
      teams: await listTeamsForUser(user.id),
    };
  },
};
