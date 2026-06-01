// Express routers for the agent CRUD API and the LLM model/recommendation registry.
import { Router } from "express";
import { z } from "zod";
import { prisma, ensureAgentBackingUser } from "@internal/db";
import {
  listAvailableTools,
  listToolGroups,
  resolveTools,
  recommendationsForKind,
} from "@internal/llm-core";
import { runAgent, startAgentRun, cancelAgentRun } from "./executor";

export {
  runAgent,
  startAgentRun,
  cancelAgentRun,
  reconcileStaleAgentRuns,
  type RunAgentInput,
  type RunAgentResult,
  type RunAgentToolCall,
  type RunAgentStep,
} from "./executor";
export {
  catalogEnricherJob,
  getAgentJobs,
  type AgentJobDefinition,
  type AgentJobContext,
} from "./jobs";
export {
  registerTools,
  resolveTools,
  type RegisteredTool,
  type ToolContext,
} from "@internal/llm-core";

export const agentsRouter: Router = Router();
export const llmRouter: Router = Router();

// Seeded agents are referenced by FK and the enrichment cron, so they cannot be deleted.
const PROTECTED_AGENT_IDS = new Set(["seed-agent-assistant", "seed-agent-catalog-enricher"]);

// The Platform Assistant's tool set is computed live in streamAgent (read groups + env-gated chat writes), so its persisted toolIds are display-only. Edits to them are ignored and the form renders them read-only.
const PLATFORM_ASSISTANT_AGENT_ID = "seed-agent-assistant";

async function getCallerTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, team: { deletedAt: null } },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

async function validateModelForTools(
  modelId: string,
  toolIds: string[],
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const model = await prisma.llmModel.findUnique({
    where: { id: modelId },
    select: {
      id: true,
      enabled: true,
      supportsTools: true,
      provider: { select: { enabled: true } },
    },
  });
  if (!model || !model.enabled || !model.provider.enabled) {
    return {
      ok: false,
      status: 400,
      body: { error: "modelId is not a registered, enabled model" },
    };
  }
  if (toolIds.length > 0 && !model.supportsTools) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "This model does not support tools. Pick a tool-capable model or remove the tools.",
        code: "model_lacks_tools",
      },
    };
  }
  return { ok: true };
}

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

llmRouter.get("/recommendations", async (req, res) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : "custom";
  const rec = recommendationsForKind(kind);
  const models = await prisma.llmModel.findMany({
    where: { slug: { in: rec.recommendedModelSlugs }, enabled: true, provider: { enabled: true } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(models.map((m) => [m.slug, m.id]));
  const recommendedModelIds = rec.recommendedModelSlugs
    .map((s) => bySlug.get(s))
    .filter((id): id is string => Boolean(id));
  res.json({ kind, requiresTools: rec.requiresTools, recommendedModelIds });
});

agentsRouter.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      llmModel: {
        select: {
          slug: true,
          displayName: true,
          provider: { select: { slug: true, displayName: true } },
        },
      },
      // Status is derived from the latest run, not stored on the agent (concurrent runs would race a shared column).
      runs: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  const items = agents.map(({ runs, ...agent }) => ({
    ...agent,
    status: runs[0]?.status ?? "idle",
  }));
  res.json({ items });
});

agentsRouter.get("/tools", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const ctx = {
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
    teamIds: [],
  };
  res.json({
    items: listAvailableTools(ctx),
    groups: listToolGroups(ctx),
  });
});

agentsRouter.get("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  // Runs carry user content (chat turns persist as AgentRun); non-admins only see their own, admins see all.
  const isAdmin = req.user.role === "admin";
  const agent = await prisma.agent.findUnique({
    where: { id: req.params.id },
    include: {
      llmModel: { include: { provider: true } },
      runs: {
        where: isAdmin ? undefined : { userId: req.user.id },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          trigger: true,
          tokensInput: true,
          tokensOutput: true,
          costUsd: true,
          startedAt: true,
          finishedAt: true,
          task: { select: { id: true, title: true, projectId: true } },
          conversation: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  // Derived from the most recent run (scoped above); the agent row no longer stores status.
  res.json({
    ...agent,
    status: agent.runs[0]?.status ?? "idle",
    toolsManaged: agent.id === PLATFORM_ASSISTANT_AGENT_ID,
  });
});

agentsRouter.get("/:id/runs/:runId", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const run = await prisma.agentRun.findUnique({
    where: { id: req.params.runId },
    include: { agent: { select: { name: true, avatarUrl: true } } },
  });
  if (!run || run.agentId !== req.params.id) {
    return res.status(404).json({ error: "Run not found" });
  }
  const isAdmin = req.user.role === "admin";
  if (!isAdmin && run.userId !== req.user.id) {
    return res.status(404).json({ error: "Run not found" });
  }
  res.json(run);
});

agentsRouter.post("/:id/runs/:runId/cancel", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId } });
  if (!run || run.agentId !== req.params.id) {
    return res.status(404).json({ error: "Run not found" });
  }
  const isAdmin = req.user.role === "admin";
  if (!isAdmin && run.userId !== req.user.id) {
    return res.status(404).json({ error: "Run not found" });
  }
  if (run.status !== "running") {
    return res.status(409).json({ error: "Run is not running" });
  }
  // Graceful abort if the run is live here; otherwise it is orphaned (a prior process died mid-run),
  // so mark it failed directly. Single-process deployment, so "no live handle" means "not running".
  const cancelled = cancelAgentRun(run.id);
  if (!cancelled) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "cancelled", error: "Cancelled by user", finishedAt: new Date() },
    });
  }
  res.json({ ok: true, aborted: cancelled });
});

const avatarUrlSchema = z
  .string()
  .max(1_500_000)
  .refine(
    (v) => v.startsWith("data:image/") || v.startsWith("/"),
    "avatarUrl must be an uploaded image or a root-relative path",
  )
  .nullable()
  .optional();

const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  avatarUrl: avatarUrlSchema,
  category: z.string().max(60).nullable().optional(),
  kind: z.string().min(1).max(60).default("custom"),
  modelId: z.string().min(1),
  instructions: z.string().min(1).max(20000),
  toolIds: z.array(z.string()).default([]),
  approvalMode: z.enum(["auto", "ask"]).default("ask"),
  maxToolCalls: z.number().int().min(1).max(50).default(10),
  tokenBudget: z.number().int().min(1).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

agentsRouter.post("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can create agents" });
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }
  const data = parsed.data;

  const check = await validateModelForTools(data.modelId, data.toolIds);
  if (!check.ok) return res.status(check.status).json(check.body);

  if (data.toolIds.length > 0) {
    try {
      resolveTools(data.toolIds);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const created = await prisma.agent.create({
    data: {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl ?? null,
      category: data.category ?? null,
      kind: data.kind,
      modelId: data.modelId,
      instructions: data.instructions,
      toolIds: data.toolIds,
      approvalMode: data.approvalMode,
      maxToolCalls: data.maxToolCalls,
      tokenBudget: data.tokenBudget ?? null,
      temperature: data.temperature ?? null,
    },
  });
  const backingUserId = await ensureAgentBackingUser(created.id, {
    name: created.name,
    avatarUrl: created.avatarUrl,
  });
  res.status(201).json({ ...created, userId: backingUserId });
});

const updateAgentSchema = createAgentSchema.partial();

agentsRouter.patch("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can edit agents" });
  const existing = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Agent not found" });

  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }
  const data = parsed.data;

  // The assistant's tools are code-owned; drop any toolIds edit so the DB never holds a set that does not match what streamAgent runs.
  if (req.params.id === PLATFORM_ASSISTANT_AGENT_ID) {
    data.toolIds = undefined;
  }

  const effectiveModelId = data.modelId ?? existing.modelId;
  const effectiveToolIds =
    data.toolIds ??
    (Array.isArray(existing.toolIds) ? (existing.toolIds as unknown as string[]) : []);
  const check = await validateModelForTools(effectiveModelId, effectiveToolIds);
  if (!check.ok) return res.status(check.status).json(check.body);

  if (data.toolIds && data.toolIds.length > 0) {
    try {
      resolveTools(data.toolIds);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const updated = await prisma.agent.update({
    where: { id: req.params.id },
    data: {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
      category: data.category,
      kind: data.kind,
      modelId: data.modelId,
      instructions: data.instructions,
      toolIds: data.toolIds,
      approvalMode: data.approvalMode,
      maxToolCalls: data.maxToolCalls,
      tokenBudget: data.tokenBudget,
      temperature: data.temperature,
    },
  });
  // Keep the backing User's display identity in sync (and create it for agents predating the backing-user link).
  await ensureAgentBackingUser(updated.id, { name: updated.name, avatarUrl: updated.avatarUrl });
  res.json(updated);
});

agentsRouter.delete("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can delete agents" });
  if (PROTECTED_AGENT_IDS.has(req.params.id)) {
    return res.status(400).json({ error: "This is a built-in agent and cannot be deleted." });
  }
  const existing = await prisma.agent.findUnique({
    where: { id: req.params.id },
    select: { id: true, userId: true },
  });
  if (!existing) return res.status(404).json({ error: "Agent not found" });
  await prisma.agent.delete({ where: { id: req.params.id } });
  // Remove the backing User so a deleted agent stops appearing in assignee/share pickers (cascades its task assignments and comments).
  if (existing.userId) {
    await prisma.user.delete({ where: { id: existing.userId } }).catch(() => {});
  }
  res.status(204).end();
});

const testAgentSchema = z.object({ prompt: z.string().min(1).max(8000) });

agentsRouter.post("/:id/test", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can run agents" });
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
        trigger: "test",
      },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const runAgentSchema = z.object({ input: z.record(z.string(), z.unknown()).default({}) });

agentsRouter.post("/:id/run", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can run agents" });
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
  try {
    const kicked = await startAgentRun(req.params.id, parsed.data.input, {
      callerUserId: req.user.id,
      callerIsAdmin: req.user.role === "admin",
      callerTeamIds: teamIds,
      trigger: "manual",
    });
    res.status(202).json({ runId: kicked.runId, agentId: req.params.id, status: "running" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
