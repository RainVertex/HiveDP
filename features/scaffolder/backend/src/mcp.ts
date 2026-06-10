import { randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { prisma } from "@internal/db";
import {
  buildPlan,
  paramsHash as computeParamsHash,
  resolveTarget,
  templateContentHash,
  type Actor,
  type Audience,
  type SandboxTarget,
} from "@internal/scaffolder-core";
import { filterByTemplateAcl } from "./services/acl";
import { z } from "zod";
import { verifyMcpToken } from "./services/mcp-tokens";
import { getActionRegistry, getTemplateRegistry } from "./services/registry";
import { buildPlanCtx } from "./services/plan-ctx";
import { loadCapabilityPolicy } from "./services/policy";
import { applyPlan, ApprovalsMissingError, PlanExpiredError } from "./services/apply";
import { StalePlanError, TargetLockBusyError } from "./services/locks";
import { createApprovalSigner, type ApprovalGrant } from "./services/approvals";
import { loadEnvSecrets } from "./services/secrets";

// MCP HTTP router exposing scaffolder templates as tools for external agents over bearer-token auth.

interface McpAuthContext {
  tokenId: string;
  userId: string;
  scopes: string[];
  actor: Actor;
}

// Bearer-token middleware: verifies the token, attaches the MCP auth context, else 401.
const requireMcpToken: RequestHandler = async (req, res, next) => {
  try {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    const ctx = await verifyMcpToken(match[1]!);
    if (!ctx) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const memberships = await prisma.teamMembership.findMany({
      where: { userId: ctx.userId, team: { deletedAt: null } },
      select: { teamId: true },
    });
    const actor: Actor = {
      kind: "external-agent",
      userId: ctx.userId,
      teamIds: memberships.map((m) => m.teamId),
    };
    const auth: McpAuthContext = {
      tokenId: ctx.tokenId,
      userId: ctx.userId,
      scopes: ctx.scopes,
      actor,
    };
    res.locals.mcp = auth;
    next();
  } catch (err) {
    next(err);
  }
};

function templateAllowedForToken(templateId: string, scopes: string[]): boolean {
  if (scopes.includes("*")) return true;
  return scopes.includes(templateId);
}

function auditFor(req: Request, kind: string, payload: Record<string, unknown>): void {
  const auth = res(req).locals.mcp as McpAuthContext | undefined;
  if (!auth) return;
  void prisma.auditEvent
    .create({
      data: {
        actorUserId: auth.userId,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
        kind,
        payload: payload as never,
      },
    })
    .catch(() => {});
}

// Lifts res off req for closures below that only capture req.
function res(req: Request): { locals: { mcp?: McpAuthContext } } {
  return (req as Request & { res?: Response }).res ?? { locals: {} };
}

async function buildMcpServer(req: Request): Promise<McpServer> {
  const auth = res(req).locals.mcp as McpAuthContext;
  const server = new McpServer({ name: "scaffolder", version: "1.0.0" });
  const templates = getTemplateRegistry().list();
  const visible = await filterByTemplateAcl(templates, auth.actor, false);

  // One tool per agent-audience template; template id is sanitized to a valid MCP tool identifier.
  for (const template of visible) {
    if (!template.metadata.audience.includes("agent" as Audience)) continue;
    if (!templateAllowedForToken(template.metadata.id, auth.scopes)) continue;
    // Pull the raw shape off z.object() for the SDK; non-object schemas fall back to undefined.
    const params = template.parameters as unknown as {
      shape?: Record<string, z.ZodTypeAny>;
    };
    const shape: Record<string, z.ZodTypeAny> | undefined = params.shape;
    const id = `scaffolder_${template.metadata.id.replace(/-/g, "_")}`;
    server.registerTool(
      id,
      {
        description: `${template.metadata.name}. ${template.metadata.description} Returns a Plan; apply it via apply_plan.`,
        inputSchema: shape,
      },
      async (args: unknown) => {
        const plan = await runBuildPlan(template.metadata.id, args, auth);
        auditFor(req, "scaffolder.plan.created", {
          planId: plan.id,
          templateId: plan.templateId,
          templateVersion: plan.templateVersion,
          mode: plan.mode,
          target: plan.target,
          actorKind: "external-agent",
          requiresApproval: plan.requiresApproval.length,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
        };
      },
    );
  }

  server.registerTool(
    "get_plan",
    {
      description: "Fetch a previously-created Plan by id.",
      inputSchema: { planId: z.string() },
    },
    async ({ planId }: { planId: string }) => {
      const row = await prisma.scaffoldPlan.findUnique({ where: { id: planId } });
      if (!row || row.createdByUserId !== auth.userId) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Plan not found" }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }],
      };
    },
  );

  server.registerTool(
    "apply_plan",
    {
      description:
        "Apply a previously-created Plan. Set dryRun=true to validate without touching the live system.",
      inputSchema: { planId: z.string(), dryRun: z.boolean().optional() },
    },
    async ({ planId, dryRun }: { planId: string; dryRun?: boolean }) => {
      const result = await runApplyPlan(planId, dryRun ?? false, auth, req);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        ...(result.kind === "error" ? { isError: true } : {}),
      };
    },
  );

  server.registerTool(
    "list_bindings",
    {
      description: "List ScaffoldBindings created via the scaffolder, scoped to the caller.",
    },
    async () => {
      const rows = await prisma.scaffoldBinding.findMany({
        where: { appliedByUserId: auth.userId },
        orderBy: { appliedAt: "desc" },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  return server;
}

async function runBuildPlan(templateId: string, rawParams: unknown, auth: McpAuthContext) {
  const template = getTemplateRegistry().get(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const target = resolveTarget(template, "agent");
  const planCtx = buildPlanCtx({ actor: auth.actor, target });
  const policy = loadCapabilityPolicy();
  const contentHash = templateContentHash({
    templateId: template.metadata.id,
    version: template.metadata.version,
    moduleSource: template.metadata.id + template.metadata.version,
  });
  const phash = computeParamsHash(rawParams);
  const existingBinding = await prisma.scaffoldBinding.findFirst({
    where: { templateId: template.metadata.id, paramsHash: phash, active: true },
    select: { id: true },
  });
  const built = await buildPlan({
    template,
    rawParams: rawParams ?? {},
    actor: auth.actor,
    ctx: planCtx,
    templateContentHash: contentHash,
    target,
    bindingId: existingBinding?.id ?? null,
    policy,
    actions: getActionRegistry(),
  });
  await prisma.scaffoldPlan.create({
    data: {
      id: built.plan.id,
      templateId: built.plan.templateId,
      templateVersion: built.plan.templateVersion,
      templateHash: built.plan.templateContentHash,
      params: built.plan.params as never,
      paramsHash: built.plan.paramsHash,
      mode: built.plan.mode === "no-op" ? "no_op" : built.plan.mode,
      target: built.plan.target,
      capabilities: built.plan.capabilities,
      irreversible: built.plan.irreversible,
      bindingId: built.plan.bindingId,
      artifact: { steps: built.plan.steps, resolvedSteps: built.resolvedSteps } as never,
      requiresApproval: built.plan.requiresApproval as never,
      approvalsGranted: [] as never,
      createdByUserId: auth.userId,
      actorKind: auth.actor.kind,
      createdAt: new Date(built.plan.createdAt),
      expiresAt: new Date(built.plan.expiresAt),
    },
  });
  return built.plan;
}

type ApplyPlanOutcome =
  | {
      kind: "ok";
      taskId: string;
      status: string;
      output: Record<string, unknown>;
      error: string | null;
      rolledBack: boolean;
    }
  | { kind: "error"; reason: string; missingCapabilities?: string[] };

async function runApplyPlan(
  planId: string,
  dryRun: boolean,
  auth: McpAuthContext,
  req: Request,
): Promise<ApplyPlanOutcome> {
  const planRow = await prisma.scaffoldPlan.findUnique({ where: { id: planId } });
  if (!planRow) return { kind: "error", reason: "Plan not found" };
  if (planRow.createdByUserId !== auth.userId) return { kind: "error", reason: "Forbidden" };
  if (planRow.appliedTaskId) return { kind: "error", reason: "Plan already applied" };

  const artifact = planRow.artifact as unknown as {
    steps: Awaited<ReturnType<typeof buildPlan>>["plan"]["steps"];
    resolvedSteps: Array<{ stepId: string; action: string; input: unknown }>;
  };
  const plan = {
    id: planRow.id,
    templateId: planRow.templateId,
    templateVersion: planRow.templateVersion,
    templateContentHash: planRow.templateHash,
    params: planRow.params as Record<string, unknown>,
    paramsHash: planRow.paramsHash,
    bindingId: planRow.bindingId,
    mode: (planRow.mode === "no_op" ? "no-op" : planRow.mode) as "create" | "update" | "no-op",
    createdAt: planRow.createdAt.toISOString(),
    expiresAt: planRow.expiresAt.toISOString(),
    target: planRow.target as SandboxTarget,
    capabilities: planRow.capabilities as Awaited<
      ReturnType<typeof buildPlan>
    >["plan"]["capabilities"],
    irreversible: planRow.irreversible,
    requiresApproval: planRow.requiresApproval as unknown as Awaited<
      ReturnType<typeof buildPlan>
    >["plan"]["requiresApproval"],
    steps: artifact.steps,
    actor: auth.actor,
  };
  const planCtx = buildPlanCtx({
    actor: auth.actor,
    target: plan.target,
  });
  const approvals = (planRow.approvalsGranted ?? []) as unknown as ApprovalGrant[];

  try {
    const result = await applyPlan({
      plan,
      resolvedSteps: artifact.resolvedSteps,
      actions: getActionRegistry(),
      planCtx,
      triggeredByUserId: auth.userId,
      dryRun,
      requestId: req.id != null ? String(req.id) : undefined,
      approvals,
      secrets: loadEnvSecrets(),
    });
    if (!dryRun) {
      await prisma.scaffoldPlan.update({
        where: { id: planRow.id },
        data: { appliedTaskId: result.taskId },
      });
      auditFor(req, "scaffolder.task.applied", {
        taskId: result.taskId,
        planId: planRow.id,
        templateId: planRow.templateId,
        status: result.status,
        rolledBack: result.rolledBack,
        durationMs: 0,
      });
    }
    return {
      kind: "ok",
      taskId: result.taskId,
      status: result.status,
      output: result.output,
      error: result.error,
      rolledBack: result.rolledBack,
    };
  } catch (err) {
    if (err instanceof ApprovalsMissingError) {
      return {
        kind: "error",
        reason: "Approvals missing",
        missingCapabilities: err.missingCapabilities,
      };
    }
    if (err instanceof PlanExpiredError) return { kind: "error", reason: "Plan expired" };
    if (err instanceof StalePlanError)
      return { kind: "error", reason: "Plan stale, replan required" };
    if (err instanceof TargetLockBusyError) return { kind: "error", reason: "Target busy" };
    return {
      kind: "error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// Referenced to keep the approvals module imported so the bundler resolves applyPlan's paths.
void createApprovalSigner;
void randomUUID;

export function createScaffolderMcpRouter(): Router {
  const router = Router();
  router.use(requireMcpToken);

  router.post("/", async (req, res, next) => {
    try {
      const server = await buildMcpServer(req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      // Pass the already-parsed body so the SDK does not re-read the request stream.
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  // Stateless MCP transport is POST-only.
  router.get("/", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed; use POST" });
  });

  return router;
}
