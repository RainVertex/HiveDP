import { prisma } from "@internal/db";
import { z } from "zod";
import type { RegisteredTool, ToolContext } from "@internal/llm-core";
import { createTeamRequest } from "@feature/teams-backend";
import type { ChatPolicyCheck } from "@internal/shared-types";
import { createPreview, resolveForSubmit, markConsumed } from "../preview";
import { requireUserId } from "./core";

// team_request_*, chat write tools wrapping createTeamRequest() (the
// extracted service function in features/teams/backend/src/requests.ts).
// Both phases enforce the same hard-rule policies the UI route enforces.
// the prepare/submit split exists so the user can confirm before any DB
// state changes.

const slugRule = /^[a-z0-9][a-z0-9-]*-team$/;

const inputSchema = z.object({
  slug: z.string().min(2).max(64).regex(slugRule, {
    message: "Slug must be kebab-case and end with -team (e.g. 'payments-team')",
  }),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  mirrorToGithub: z.boolean().default(false),
  githubIntegrationId: z.string().min(1).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface ChatToolCtx extends ToolContext {
  conversationId?: string;
  agentRunId?: string;
}

function getConversationId(ctx: ChatToolCtx): string {
  if (!ctx.conversationId) {
    throw new Error("Conversation context missing — internal error");
  }
  return ctx.conversationId;
}

const TEAM_REQUEST_PREPARE_TOOL_ID = "team_request_prepare";
const TEAM_REQUEST_SUBMIT_TOOL_ID = "team_request_submit";

const prepare: RegisteredTool = {
  id: TEAM_REQUEST_PREPARE_TOOL_ID,
  openaiDef: {
    type: "function",
    function: {
      name: TEAM_REQUEST_PREPARE_TOOL_ID,
      description:
        "Prepare a team-creation request. Returns a preview handle for team_request_submit; the user must confirm between prepare and submit.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Team slug, e.g. 'payments-team'.",
          },
          name: { type: "string", description: "Display name for the team." },
          description: { type: "string", description: "Optional description (max 1000 chars)." },
          mirrorToGithub: {
            type: "boolean",
            description:
              "Optional. If true, approval also creates a matching team in the linked GitHub org. Omit for org-only teams.",
          },
          githubIntegrationId: {
            type: "string",
            description:
              "Required when mirrorToGithub is true. Accepts either the GitHub org/account login (e.g. 'acme-corp') or the Integration.id cuid — both resolve server-side. Call integrations_list_github first if unsure what's connected. NEVER ask the user to type a cuid.",
          },
        },
        required: ["slug", "name"],
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

    // Resolve githubIntegrationId leniently: accept either the Integration row
    // id (a cuid) or the GitHub accountLogin (e.g. "m-engineering-platform").
    // Without this, when the model passes the org login as the id (because
    // that's what the user said and the model skipped integrations_list_github)
    // the submit step fails much later with a cryptic foreign-key violation
    // from Prisma. Resolving here turns it into a clean policy-check failure
    // the model can recover from in the same turn.
    let resolvedIntegrationId = input.githubIntegrationId;
    let resolvedAccountLogin: string | null = null;
    if (input.mirrorToGithub) {
      if (!input.githubIntegrationId) {
        policyChecks.push({
          name: "mirror_target",
          passed: false,
          message:
            "Mirroring requires a target GitHub installation. Ask the user which org to mirror into, or call integrations_list_github to see what's connected, then pass the org login (or its integrationId) as githubIntegrationId.",
        });
      } else {
        const provided = input.githubIntegrationId.trim();
        // Try the literal value as Integration.id first (the happy path).
        let match = await prisma.integration.findFirst({
          where: { id: provided, kind: "github", enabled: true },
          select: { id: true, config: true },
        });
        // Fall back to matching by accountLogin (case-insensitive) so an
        // org-name input still resolves cleanly.
        if (!match) {
          const candidates = await prisma.integration.findMany({
            where: { kind: "github", enabled: true },
            select: { id: true, config: true },
          });
          match =
            candidates.find((row) => {
              const cfg = row.config;
              const accountLogin =
                cfg && typeof cfg === "object" && !Array.isArray(cfg)
                  ? ((cfg as Record<string, unknown>).accountLogin as unknown)
                  : null;
              return (
                typeof accountLogin === "string" &&
                accountLogin.toLowerCase() === provided.toLowerCase()
              );
            }) ?? null;
        }
        if (match) {
          const cfg = match.config;
          const accountLogin =
            cfg && typeof cfg === "object" && !Array.isArray(cfg)
              ? ((cfg as Record<string, unknown>).accountLogin as unknown)
              : null;
          resolvedIntegrationId = match.id;
          resolvedAccountLogin = typeof accountLogin === "string" ? accountLogin : null;
          policyChecks.push({
            name: "mirror_target_exists",
            passed: true,
            message: resolvedAccountLogin
              ? `GitHub installation found: ${resolvedAccountLogin}`
              : "GitHub installation found",
          });
        } else {
          // Surface the available options so the model can recover by asking
          // the user to pick one, rather than blindly retrying.
          const all = await prisma.integration.findMany({
            where: { kind: "github", enabled: true },
            select: { config: true },
          });
          const available = all
            .map((row) => {
              const cfg = row.config;
              return cfg && typeof cfg === "object" && !Array.isArray(cfg)
                ? ((cfg as Record<string, unknown>).accountLogin as unknown)
                : null;
            })
            .filter((v): v is string => typeof v === "string" && v.length > 0);
          policyChecks.push({
            name: "mirror_target_exists",
            passed: false,
            message:
              available.length > 0
                ? `No connected GitHub installation matches "${provided}" (matched neither an org login nor an integrationId). Connected orgs: ${available.join(", ")}. Tell the user the available options and ask them to pick one.`
                : `No GitHub App is connected to this platform yet. Tell the user they need to install a GitHub App from Settings → Integrations before mirroring is possible — do not retry mirror:yes until they confirm an installation exists.`,
          });
        }
      }
    }

    // Slug-availability check (live teams).
    const liveTeam = await prisma.team.findFirst({
      where: { slug: input.slug, deletedAt: null },
      select: { id: true },
    });
    policyChecks.push({
      name: "slug_available",
      passed: !liveTeam,
      message: liveTeam ? "A team with this slug already exists" : "Slug is available",
    });

    // Pending-request availability check. The DB-level partial unique index
    // (team_request_unique_pending_slug) blocks duplicates at submit time
    // but a chat user has already gone through slot-filling + confirmation by
    // then. Surface the conflict here so the model can warn the user before
    // they confirm. The status filter mirrors the partial unique index in
    // 20260507120000_team_request_policies_and_mirror.sql.
    const pendingConflict = await prisma.teamRequest.findFirst({
      where: {
        slug: input.slug,
        status: { in: ["pending", "awaiting_user_confirmation"] },
      },
      select: {
        requestedByUserId: true,
        requestedBy: { select: { displayName: true, githubLogin: true } },
      },
    });
    if (pendingConflict) {
      const sameUser = pendingConflict.requestedByUserId === userId;
      const requesterName =
        pendingConflict.requestedBy?.displayName ||
        pendingConflict.requestedBy?.githubLogin ||
        "another user";
      policyChecks.push({
        name: "pending_request_available",
        passed: false,
        message: sameUser
          ? "You already have an open request for this slug — open My Requests to manage it."
          : `User ${requesterName} has an open request for this slug — pick a different slug, or wait for theirs to be resolved.`,
      });
    } else {
      policyChecks.push({
        name: "pending_request_available",
        passed: true,
        message: "No open request for this slug",
      });
    }

    const sideEffects: string[] = [
      `Create TeamRequest row with status=pending, slug=${input.slug}, name=${input.name}`,
      "Notify all admins via in-app notifications",
    ];
    if (input.mirrorToGithub) {
      sideEffects.push(
        resolvedAccountLogin
          ? `On approval, create a matching team in the linked GitHub org "${resolvedAccountLogin}"`
          : "On approval, create a matching team in the linked GitHub org",
      );
    }

    const summaryParts = [
      `Create team ${input.slug}`,
      `name: ${input.name}`,
      input.description ? `description: ${input.description}` : null,
      input.mirrorToGithub
        ? `mirror to GitHub: yes${resolvedAccountLogin ? ` (${resolvedAccountLogin})` : ""}`
        : "mirror to GitHub: no",
    ].filter(Boolean);
    const serverSummary = summaryParts.join(" • ");

    // Persist the *resolved* integrationId (not the user's raw input) so the
    // submit step uses a real cuid and never re-runs the FK gauntlet.
    const persistedParams: Input = {
      ...input,
      githubIntegrationId: resolvedIntegrationId,
    };

    return createPreview({
      conversationId,
      userId,
      toolId: TEAM_REQUEST_PREPARE_TOOL_ID,
      parsedParams: persistedParams as unknown as Record<string, unknown>,
      serverSummary,
      policyChecks,
      sideEffects,
    });
  },
};

const submitSchema = z.object({ handle: z.string().min(1) });

const submit: RegisteredTool = {
  id: TEAM_REQUEST_SUBMIT_TOOL_ID,
  openaiDef: {
    type: "function",
    function: {
      name: TEAM_REQUEST_SUBMIT_TOOL_ID,
      description:
        "Submit a previously-prepared team-creation request. Pass the handle (e.g. 'prv_01') returned by team_request_prepare. ONLY call after the user has explicitly confirmed.",
      parameters: {
        type: "object",
        properties: {
          handle: {
            type: "string",
            description: "Short handle from team_request_prepare, e.g. 'prv_01'.",
          },
        },
        required: ["handle"],
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const userId = requireUserId(ctx);
    const conversationId = getConversationId(ctx as ChatToolCtx);
    const agentRunId = (ctx as ChatToolCtx).agentRunId;

    const parsed = submitSchema.safeParse(rawArgs);
    if (!parsed.success) return { error: "handle is required" };

    const resolved = await resolveForSubmit({
      handle: parsed.data.handle,
      conversationId,
      userId,
      toolId: TEAM_REQUEST_SUBMIT_TOOL_ID,
    });
    if (!resolved.ok) {
      return { error: resolved.error.message, code: resolved.error.code };
    }
    if (resolved.kind === "alreadyConsumed") {
      return {
        ok: true,
        alreadySubmittedAt: resolved.consumedAt.toISOString(),
        teamRequestId: resolved.resultRefId,
      };
    }

    const preview = resolved.preview;
    const params = preview.parsedParams as unknown as Input;

    const result = await createTeamRequest(
      {
        slug: params.slug,
        name: params.name,
        description: params.description,
        mirrorToGithub: params.mirrorToGithub,
        githubIntegrationId: params.githubIntegrationId,
      },
      {
        requestedByUserId: userId,
        actorIp: null,
        requestId: null,
        extraAuditPayload: {
          source: "chat",
          conversationId,
          agentRunId: agentRunId ?? null,
          previewId: preview.id,
        },
      },
    );
    if (!result.ok) {
      return { error: result.message, code: result.code };
    }

    await markConsumed({
      previewId: preview.id,
      resultRefId: result.request.id,
    });

    return {
      ok: true,
      teamRequestId: result.request.id,
      slug: result.request.slug,
      status: result.request.status,
      message: `Submitted team request ${result.request.id}. Admins have been notified.`,
    };
  },
};

export const TEAM_REQUEST_WRITE_TOOLS: RegisteredTool[] = [prepare, submit];
export const TEAM_REQUEST_WRITE_TOOL_IDS = TEAM_REQUEST_WRITE_TOOLS.map((t) => t.id);
