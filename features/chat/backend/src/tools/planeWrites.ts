import { prisma } from "@internal/db";
import { z } from "zod";
import type { RegisteredTool, ToolContext } from "@feature/agents-backend";
import { clientForIntegration, upsertWorkItem, workspaceSlugOf } from "@feature/workspace-backend";
import { createPlaneClient, PlaneApiError } from "@internal/plane-client";
import { decryptSecret } from "@internal/db";
import type { ChatPolicyCheck } from "@internal/shared-types";
import { createPreview, markConsumed, resolveForSubmit } from "../preview";
import { requireUserId } from "./core";

const priorityEnum = z.enum(["urgent", "high", "medium", "low", "none"]);

const inputSchema = z.object({
  project: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: priorityEnum.default("none"),
});

type Input = z.infer<typeof inputSchema>;

interface ChatToolCtx extends ToolContext {
  conversationId?: string;
  agentRunId?: string;
}

function getConversationId(ctx: ChatToolCtx): string {
  if (!ctx.conversationId) throw new Error("Conversation context missing");
  return ctx.conversationId;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function resolveProject(input: string): Promise<{
  id: string;
  externalId: string;
  identifier: string;
  name: string;
  integrationId: string;
} | null> {
  const trimmed = input.trim();
  const byId = await prisma.planeProject.findUnique({
    where: { id: trimmed },
    select: {
      id: true,
      externalId: true,
      identifier: true,
      name: true,
      integrationId: true,
      archivedAt: true,
    },
  });
  if (byId && !byId.archivedAt) return byId;
  const byIdentifier = await prisma.planeProject.findFirst({
    where: { identifier: { equals: trimmed, mode: "insensitive" }, archivedAt: null },
    select: { id: true, externalId: true, identifier: true, name: true, integrationId: true },
  });
  return byIdentifier;
}

const PLANE_CREATE_WORK_ITEM_PREPARE_ID = "plane_create_work_item_prepare";
const PLANE_CREATE_WORK_ITEM_SUBMIT_ID = "plane_create_work_item_submit";

const prepare: RegisteredTool = {
  id: PLANE_CREATE_WORK_ITEM_PREPARE_ID,
  openaiDef: {
    type: "function",
    function: {
      name: PLANE_CREATE_WORK_ITEM_PREPARE_ID,
      description:
        "Prepare creating a Plane work item in a project. Returns a preview handle for plane_create_work_item_submit; the user must confirm between prepare and submit.",
      parameters: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description:
              "Project identifier (e.g. 'AXONO') or local project id (cuid). Identifier preferred since users will say it; both resolve server-side.",
          },
          name: {
            type: "string",
            description: "Work item title (max 200 chars).",
          },
          description: {
            type: "string",
            description: "Optional body text (max 5000 chars, plain text).",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low", "none"],
            description: "Priority. Defaults to 'none'.",
          },
        },
        required: ["project", "name"],
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const userId = requireUserId(ctx);
    const conversationId = getConversationId(ctx as ChatToolCtx);

    const parsed = inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: "Invalid input",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    }
    const input = parsed.data;

    const policyChecks: ChatPolicyCheck[] = [];

    const project = await resolveProject(input.project);
    if (!project) {
      policyChecks.push({
        name: "project_exists",
        passed: false,
        message: `No active Plane project matches "${input.project}". Tell the user to check the project identifier (e.g. 'AXONO') or open the Workspace page.`,
      });
    } else {
      policyChecks.push({
        name: "project_exists",
        passed: true,
        message: `Resolved to project ${project.identifier} (${project.name})`,
      });
    }

    if (project) {
      const integration = await prisma.integration.findUnique({
        where: { id: project.integrationId },
        select: { enabled: true },
      });
      policyChecks.push({
        name: "integration_enabled",
        passed: integration?.enabled === true,
        message:
          integration?.enabled === true
            ? "Plane integration is enabled"
            : "Plane integration is disabled; ask an admin to re-enable it before creating work items",
      });
    }

    const serverSummary = project
      ? `Create work item "${input.name}" in ${project.identifier} (priority ${input.priority})`
      : `Create work item "${input.name}" (project unresolved)`;

    const sideEffects: string[] = project
      ? [
          `Create a work item in Plane project ${project.identifier} as the admin token owner`,
          "Mirror the new item via webhook into the platform's read cache",
        ]
      : [];

    return createPreview({
      conversationId,
      userId,
      toolId: PLANE_CREATE_WORK_ITEM_PREPARE_ID,
      parsedParams: input as unknown as Record<string, unknown>,
      serverSummary,
      policyChecks,
      sideEffects,
    });
  },
};

const submitSchema = z.object({ handle: z.string().min(1) });

const submit: RegisteredTool = {
  id: PLANE_CREATE_WORK_ITEM_SUBMIT_ID,
  openaiDef: {
    type: "function",
    function: {
      name: PLANE_CREATE_WORK_ITEM_SUBMIT_ID,
      description:
        "Submit a previously-prepared Plane work item. Pass the handle (e.g. 'prv_01') returned by plane_create_work_item_prepare. ONLY call after the user has explicitly confirmed.",
      parameters: {
        type: "object",
        properties: {
          handle: {
            type: "string",
            description: "Short handle from plane_create_work_item_prepare, e.g. 'prv_01'.",
          },
        },
        required: ["handle"],
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const userId = requireUserId(ctx);
    const conversationId = getConversationId(ctx as ChatToolCtx);

    const parsed = submitSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: "handle is required" };

    const resolved = await resolveForSubmit({
      handle: parsed.data.handle,
      conversationId,
      userId,
      toolId: PLANE_CREATE_WORK_ITEM_SUBMIT_ID,
    });
    if (!resolved.ok) {
      return { error: resolved.error.message, code: resolved.error.code };
    }
    if (resolved.kind === "alreadyConsumed") {
      return {
        ok: true,
        alreadySubmittedAt: resolved.consumedAt.toISOString(),
        workItemId: resolved.resultRefId,
      };
    }

    const preview = resolved.preview;
    const params = preview.parsedParams as unknown as Input;

    const project = await resolveProject(params.project);
    if (!project) {
      return { error: "Project no longer exists" };
    }
    const integration = await prisma.integration.findUnique({
      where: { id: project.integrationId },
      select: { enabled: true, config: true },
    });
    if (!integration || !integration.enabled) {
      return { error: "Plane integration is unavailable" };
    }

    const slug = workspaceSlugOf(integration.config);
    const cfg = (integration.config ?? {}) as Record<string, unknown>;
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";

    const oauthToken = await prisma.planeOAuthToken.findUnique({
      where: { userId_integrationId: { userId, integrationId: project.integrationId } },
      select: { encryptedAccessToken: true },
    });
    const client = oauthToken
      ? createPlaneClient({
          baseUrl,
          apiToken: decryptSecret(oauthToken.encryptedAccessToken),
          authMode: "bearer",
        })
      : clientForIntegration(integration.config);

    const descriptionHtml = params.description ? `<p>${escapeHtml(params.description)}</p>` : "";

    let created;
    try {
      created = await client.createWorkItem(slug, project.externalId, {
        name: params.name,
        description_html: descriptionHtml,
        priority: params.priority,
      });
    } catch (err) {
      if (err instanceof PlaneApiError) {
        return { error: `Plane rejected the work item (${err.status}): ${err.body.slice(0, 200)}` };
      }
      throw err;
    }

    const persisted = await prisma.$transaction((tx) => upsertWorkItem(tx, project.id, created));

    await markConsumed({
      previewId: preview.id,
      resultRefId: persisted.id,
    });

    return {
      ok: true,
      workItemId: persisted.id,
      externalId: created.id,
      sequenceId: created.sequence_id,
      project: { id: project.id, identifier: project.identifier, name: project.name },
      message: `Created ${project.identifier}-${created.sequence_id}: ${params.name}`,
    };
  },
};

export const PLANE_WRITE_TOOLS: RegisteredTool[] = [prepare, submit];
export const PLANE_WRITE_TOOL_IDS = PLANE_WRITE_TOOLS.map((t) => t.id);
