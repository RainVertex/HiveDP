import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "../core";
import { listGithubInstallations } from "./queries";

// Read-only tool listing enabled GitHub App installations so the model can resolve an org login to the
// cuid Integration.id (without it the model hallucinates the id).

export const listGithub: RegisteredTool = {
  id: "integrations_list_github",
  openaiDef: {
    type: "function",
    function: {
      name: "integrations_list_github",
      description:
        "List enabled GitHub App installations. Returns each installation's integrationId (cuid), display name, and accountLogin (the GitHub org/user login). Use it to resolve a user's org-login answer to the integrationId other tools need. Never ask the user for the integrationId directly — humans don't memorize cuids.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    requireUserId(ctx);
    return { items: await listGithubInstallations() };
  },
};
