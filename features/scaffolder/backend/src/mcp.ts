import { Router, type Request, type RequestHandler, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { prisma } from "@internal/db";
import { type Actor } from "@internal/scaffolder-core";
import { z } from "zod";
import { filterByTemplateAcl } from "./services/acl";
import { verifyMcpToken } from "./services/mcp-tokens";
import { getTemplates } from "./services/registry";
import { buildAndPersistPlan, applyPersistedPlan } from "./services/plan-run";

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

// Lifts res off req for closures below that only capture req.
function res(req: Request): { locals: { mcp?: McpAuthContext } } {
  return (req as Request & { res?: Response }).res ?? { locals: {} };
}

// Audit metadata derived from the HTTP request, threaded into the shared plan-run service.
function auditMeta(req: Request): { actorIp: string | null; requestId: string | null } {
  return {
    actorIp: req.ip ?? null,
    requestId: req.id != null ? String(req.id) : null,
  };
}

async function buildMcpServer(req: Request): Promise<McpServer> {
  const auth = res(req).locals.mcp as McpAuthContext;
  const server = new McpServer({ name: "scaffolder", version: "1.0.0" });
  const templates = (await getTemplates()).list();
  const visible = await filterByTemplateAcl(templates, auth.actor, false);

  // One tool per agent-audience template; template id is sanitized to a valid MCP tool identifier.
  for (const template of visible) {
    if (!template.metadata.audience.includes("agent")) continue;
    if (!templateAllowedForToken(template.metadata.id, auth.scopes)) continue;
    // day2/delete templates need a catalog entity which the MCP surface cannot pick yet.
    if (template.resolvedOperation !== "create") continue;
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
        const plan = await buildAndPersistPlan({
          templateId: template.metadata.id,
          rawParams: args,
          actor: auth.actor,
          userId: auth.userId,
          audit: auditMeta(req),
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
      const result = await applyPersistedPlan({
        planId,
        dryRun: dryRun ?? false,
        actor: auth.actor,
        userId: auth.userId,
        audit: auditMeta(req),
      });
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
