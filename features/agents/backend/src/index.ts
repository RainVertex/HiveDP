import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import { listAvailableTools, resolveTools } from "./llm/toolRegistry";
import { checkAgentCreation } from "./creationGuard";
import { runAgent, startAgentRun } from "./executor";

export {
  registerTools,
  resolveTools,
  type RegisteredTool,
  type ToolContext,
} from "./llm/toolRegistry";

export {
  runAgent,
  runEnricherForEntity,
  startAgentRun,
  type RunAgentInput,
  type RunAgentResult,
  type RunAgentToolCall,
  type EnricherInput,
  type EnricherRunResult,
  type RunEnricherOptions,
} from "./executor";
export {
  catalogEnricherJob,
  getAgentJobs,
  type AgentJobDefinition,
  type AgentJobContext,
} from "./jobs";
export {
  chat,
  computeCostUsd,
  type ChatRequest,
  type ChatResult,
  type ResolvedModel,
} from "./llm/client";
export {
  selectAdapter,
  type ProviderAdapter,
  type AdapterRequest,
  type AdapterResult,
} from "./llm/adapters";
export { encryptSecret, decryptSecret, resolveProviderApiKey } from "./secrets";
export { decidePolicy } from "./approvalPolicy";
export { buildAgentRequestContext, type AgentRequestContext } from "./agentRequestContext";
export {
  checkAgentCreation,
  type CreationGuardArgs,
  type CreationGuardResult,
} from "./creationGuard";
export { secretsRouter } from "./secretsRoutes";
export { agentApprovalsRouter } from "./agentApprovalsRoutes";

export const agentsRouter: Router = Router();
export const llmRouter: Router = Router();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function getCallerTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, team: { deletedAt: null } },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

async function isTeamLead(userId: string, teamId: string): Promise<boolean> {
  const m = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true },
  });
  return m?.role === "lead";
}

// Edit / delete permissions for an agent: admin, owner, or a lead of the
// agent's owningTeamId. Run / read permissions stay open to any authenticated
// user in Phase 1; Phase 3 tightens them.
async function canManageAgent(
  agentId: string,
  user: { id: string; role: string },
): Promise<{
  ok: boolean;
  agent?: { id: string; ownerUserId: string | null; owningTeamId: string | null };
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, ownerUserId: true, owningTeamId: true },
  });
  if (!agent) return { ok: false };
  if (user.role === "admin") return { ok: true, agent };
  if (agent.ownerUserId === user.id) return { ok: true, agent };
  if (agent.owningTeamId && (await isTeamLead(user.id, agent.owningTeamId))) {
    return { ok: true, agent };
  }
  return { ok: false, agent };
}

// -----------------------------------------------------------------------------
// LLM model registry
// -----------------------------------------------------------------------------

llmRouter.get("/models", async (_req, res) => {
  const models = await prisma.llmModel.findMany({
    where: { enabled: true, provider: { enabled: true } },
    include: { provider: { select: { slug: true, displayName: true, kind: true } } },
    orderBy: [{ provider: { slug: "asc" } }, { slug: "asc" }],
  });
  res.json({
    items: models.map((m) => ({
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      modelName: m.modelName,
      contextWindow: m.contextWindow,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
      costPer1kIn: m.costPer1kIn ? Number(m.costPer1kIn) : null,
      costPer1kOut: m.costPer1kOut ? Number(m.costPer1kOut) : null,
      provider: m.provider,
    })),
  });
});

// -----------------------------------------------------------------------------
// Agents — read
// -----------------------------------------------------------------------------

agentsRouter.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const isAdmin = req.user.role === "admin";

  // Scope: admin sees all; other callers see agents they own
  // (Agent.ownerUserId) plus agents owned by teams they lead. Members not in
  // any leadership role still see their personal agents.
  const ledTeams = isAdmin
    ? []
    : await prisma.teamMembership.findMany({
        where: { userId: req.user.id, role: "lead", team: { deletedAt: null } },
        select: { teamId: true },
      });
  const ledTeamIds = ledTeams.map((m) => m.teamId);

  const agents = await prisma.agent.findMany({
    where: isAdmin
      ? {}
      : {
          OR: [
            { ownerUserId: req.user.id },
            ...(ledTeamIds.length > 0 ? [{ owningTeamId: { in: ledTeamIds } }] : []),
          ],
        },
    orderBy: { createdAt: "desc" },
    include: {
      llmModel: {
        select: {
          slug: true,
          displayName: true,
          provider: { select: { slug: true, displayName: true } },
        },
      },
    },
  });
  res.json({ items: agents });
});

agentsRouter.get("/tools", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  res.json({
    items: listAvailableTools({
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
      teamIds: [],
    }),
  });
});

agentsRouter.get("/:id", async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: {
      llmModel: { include: { provider: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 20 },
    },
  });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

agentsRouter.get("/:id/runs/:runId", async (req, res) => {
  const run = await prisma.agentRun.findUnique({
    where: { id: req.params.runId },
  });
  if (!run || run.agentId !== req.params.id) {
    return res.status(404).json({ error: "Run not found" });
  }
  res.json(run);
});

// -----------------------------------------------------------------------------
// Agents — write
// -----------------------------------------------------------------------------

const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  kind: z.string().min(1).max(60).default("custom"),
  modelId: z.string().min(1),
  instructions: z.string().min(1).max(20000),
  toolIds: z.array(z.string()).default([]),
  owningTeamId: z.string().nullable().optional(),
  maxToolCalls: z.number().int().min(1).max(50).default(10),
  tokenBudget: z.number().int().min(1).nullable().optional(),
  // Pass-3 additions: provider adapter selector, approval policy, secret
  // override, role for the backing User, autonomy toggle, monthly budgets.
  modelProvider: z.enum(["openai_compat", "anthropic", "gemini"]).default("openai_compat"),
  toolApprovalPolicy: z.record(z.string(), z.unknown()).default({}),
  secretId: z.string().nullable().optional(),
  role: z.enum(["admin", "member"]).default("member"),
  onBehalfOfRequired: z.boolean().default(true),
  tokenBudgetMonthly: z.number().int().min(1).nullable().optional(),
  costBudgetMonthly: z.number().min(0).nullable().optional(),
});

agentsRouter.post("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }
  const data = parsed.data;

  // Verify model exists and is enabled.
  const model = await prisma.llmModel.findUnique({
    where: { id: data.modelId },
    select: { id: true, enabled: true, provider: { select: { enabled: true } } },
  });
  if (!model || !model.enabled || !model.provider.enabled) {
    return res.status(400).json({ error: "modelId is not a registered, enabled model" });
  }

  // If toolIds were specified, sanity-check them against the registry now so
  // the agent isn't silently broken at run time.
  if (data.toolIds.length > 0) {
    try {
      resolveTools(data.toolIds);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  // Tiered creation rules (admin-only for role=admin or
  // onBehalfOfRequired=false; team-led for owningTeamId; etc.). See
  // creationGuard.ts for the full decision matrix.
  const guard = await checkAgentCreation({
    caller: { id: req.user.id, role: req.user.role },
    desired: {
      role: data.role,
      owningTeamId: data.owningTeamId ?? null,
      onBehalfOfRequired: data.onBehalfOfRequired,
    },
  });
  if (!guard.ok) {
    return res.status(403).json({ error: guard.reason ?? "Forbidden" });
  }

  // If a secretId was provided, sanity-check the caller can use it
  // (own personal, lead-of team, or admin for org). Org rows are both-null;
  // we don't allow a non-admin to attach an org-scoped secret.
  if (data.secretId) {
    const sec = await prisma.secret.findUnique({
      where: { id: data.secretId },
      select: { ownerUserId: true, ownerTeamId: true },
    });
    if (!sec) return res.status(400).json({ error: "secretId not found" });
    const isOrg = sec.ownerUserId === null && sec.ownerTeamId === null;
    let allowed = req.user.role === "admin" || sec.ownerUserId === req.user.id;
    if (!allowed && sec.ownerTeamId) {
      const m = await prisma.teamMembership.findUnique({
        where: { teamId_userId: { teamId: sec.ownerTeamId, userId: req.user.id } },
        select: { teamId: true },
      });
      allowed = !!m;
    }
    if (isOrg && req.user.role !== "admin") allowed = false;
    if (!allowed) {
      return res.status(403).json({ error: "Not allowed to attach this secret" });
    }
  }

  // Class-table-inheritance: every Agent has a backing User (userKind='agent')
  // that participates in role/team/grant checks the same way a human does.
  // Both rows are created in one transaction so a partial failure can't leave
  // a User without its AgentProfile or vice versa. The synthetic identifiers
  // mirror the seed-time pattern in the agents_section_and_identity migration
  // ('agent-bot-<id>' for github*, '<id>@agents.local' for email) so users
  // listings clearly distinguish bot rows.
  const newAgentId = randomUUID();
  const newUserId = `agentuser-${newAgentId}`;
  const created = await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: newUserId,
        githubId: `agent-bot-${newAgentId}`,
        githubLogin: `agent-bot-${newAgentId}`,
        email: `${newAgentId}@agents.local`,
        displayName: data.name,
        role: data.role,
        userKind: "agent",
      },
    });
    return tx.agent.create({
      data: {
        id: newAgentId,
        name: data.name,
        description: data.description,
        kind: data.kind,
        modelId: data.modelId,
        instructions: data.instructions,
        toolIds: data.toolIds,
        ownerUserId: req.user!.id,
        owningTeamId: data.owningTeamId ?? null,
        maxToolCalls: data.maxToolCalls,
        tokenBudget: data.tokenBudget ?? null,
        userId: newUserId,
        modelProvider: data.modelProvider,
        toolApprovalPolicy: data.toolApprovalPolicy as Prisma.InputJsonValue,
        secretId: data.secretId ?? null,
        onBehalfOfRequired: data.onBehalfOfRequired,
        tokenBudgetMonthly: data.tokenBudgetMonthly ?? null,
        costBudgetMonthly: data.costBudgetMonthly ?? null,
      },
    });
  });
  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// Lookup by backing User id — the sidebar's /agents/:userId pages address
// agents by their backing User row (since the wizard URLs treat agents as
// users). Existing /:id routes by Agent.id continue to work for back-compat.
// ---------------------------------------------------------------------------

agentsRouter.get("/by-user/:userId", async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { userId: req.params.userId },
    include: {
      llmModel: { include: { provider: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 20 },
    },
  });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

// ---------------------------------------------------------------------------
// One-shot synchronous test run. Used by the wizard "Try it out" button to
// verify an agent's configuration end-to-end before saving. Streaming is not
// needed here — the wizard renders the final result + tool-call summary
// once runAgent returns. For long-running production-style invocations,
// callers continue to use POST /:id/run (async, returns runId).
// ---------------------------------------------------------------------------

const testAgentSchema = z.object({
  prompt: z.string().min(1).max(8000),
});

agentsRouter.post("/:id/test", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const parsed = testAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }
  const teamIds = await getCallerTeamIds(req.user.id);
  try {
    const result = await runAgent(
      req.params.id,
      { prompt: parsed.data.prompt },
      {
        callerUserId: req.user.id,
        callerIsAdmin: req.user.role === "admin",
        callerTeamIds: teamIds,
      },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const updateAgentSchema = createAgentSchema.partial().extend({
  // owningTeamId can be set to null to detach from a team.
  owningTeamId: z.string().nullable().optional(),
});

agentsRouter.patch("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const auth = await canManageAgent(req.params.id, req.user);
  if (!auth.agent) return res.status(404).json({ error: "Agent not found" });
  if (!auth.ok) return res.status(403).json({ error: "Forbidden" });

  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }
  const data = parsed.data;

  if (data.modelId) {
    const model = await prisma.llmModel.findUnique({
      where: { id: data.modelId },
      select: { id: true, enabled: true, provider: { select: { enabled: true } } },
    });
    if (!model || !model.enabled || !model.provider.enabled) {
      return res.status(400).json({ error: "modelId is not a registered, enabled model" });
    }
  }
  if (data.toolIds && data.toolIds.length > 0) {
    try {
      resolveTools(data.toolIds);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }
  // Toggling an agent to autonomous matches the create-time admin gate in
  // creationGuard.ts — the runtime blast radius is the same regardless of
  // when the bit gets flipped.
  if (data.onBehalfOfRequired === false && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can set onBehalfOfRequired=false" });
  }

  const updated = await prisma.agent.update({
    where: { id: req.params.id },
    data: {
      name: data.name,
      description: data.description,
      kind: data.kind,
      modelId: data.modelId,
      instructions: data.instructions,
      toolIds: data.toolIds,
      owningTeamId: data.owningTeamId,
      maxToolCalls: data.maxToolCalls,
      tokenBudget: data.tokenBudget,
      toolApprovalPolicy: data.toolApprovalPolicy as Prisma.InputJsonValue | undefined,
      onBehalfOfRequired: data.onBehalfOfRequired,
    },
  });
  res.json(updated);
});

agentsRouter.delete("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const auth = await canManageAgent(req.params.id, req.user);
  if (!auth.agent) return res.status(404).json({ error: "Agent not found" });
  if (!auth.ok) return res.status(403).json({ error: "Forbidden" });
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// -----------------------------------------------------------------------------
// Agents — run (async by default)
// -----------------------------------------------------------------------------

const runAgentSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

agentsRouter.post("/:id/run", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const parsed = runAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }

  const teamIds = await getCallerTeamIds(req.user.id);
  let kicked: { runId: string };
  try {
    kicked = await startAgentRun(req.params.id, parsed.data.input, {
      callerUserId: req.user.id,
      callerIsAdmin: req.user.role === "admin",
      callerTeamIds: teamIds,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
  res.status(202).json({ runId: kicked.runId, agentId: req.params.id, status: "running" });
});
