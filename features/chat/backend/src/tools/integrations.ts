import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import { requireUserId } from "./core";

// Read-only chat tool listing enabled GitHub App installations so the model can resolve an org login to the
// cuid Integration.id team_request_prepare needs (without it the model hallucinates the id and submit fails).

const listGithub: RegisteredTool = {
  id: "integrations_list_github",
  openaiDef: {
    type: "function",
    function: {
      name: "integrations_list_github",
      description:
        "List enabled GitHub App installations available for team mirroring. Returns each installation's integrationId (cuid), display name, and accountLogin (the GitHub org/user login). Call this BEFORE team_request_prepare whenever mirrorToGithub is true so you can resolve the user's org-login answer to the integrationId the prepare tool needs. Never ask the user for the integrationId directly — humans don't memorize cuids.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    requireUserId(ctx);
    const rows = await prisma.integration.findMany({
      where: { kind: "github", enabled: true },
      select: { id: true, name: true, config: true },
      orderBy: { name: "asc" },
    });
    const items = rows
      .map((row) => {
        const cfg = row.config;
        const accountLogin =
          cfg && typeof cfg === "object" && !Array.isArray(cfg)
            ? ((cfg as Record<string, unknown>).accountLogin as unknown)
            : null;
        return {
          integrationId: row.id,
          name: row.name,
          accountLogin: typeof accountLogin === "string" ? accountLogin : "",
        };
      })
      .filter((i) => i.accountLogin.length > 0);
    return { items };
  },
};

export const INTEGRATIONS_READ_TOOLS: RegisteredTool[] = [listGithub];
export const INTEGRATIONS_READ_TOOL_IDS = INTEGRATIONS_READ_TOOLS.map((t) => t.id);
