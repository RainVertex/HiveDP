import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import {
  buildPlan,
  paramsHash as computeParamsHash,
  resolveTarget,
  templateContentHash,
  toJsonSchema,
  type Plan,
  type SandboxTarget,
  type StepEvent,
} from "@internal/scaffolder-core";
import { applyPlan, ApprovalsMissingError, PlanExpiredError } from "./services/apply";
import { StalePlanError, TargetLockBusyError } from "./services/locks";
import { taskEventBus } from "./services/events";
import { actorFromRequest } from "./services/actor";
import { getActionRegistry, getTemplateRegistry } from "./services/registry";
import { buildPlanCtx } from "./services/plan-ctx";
import { loadCapabilityPolicy } from "./services/policy";
import { createApprovalSigner, type ApprovalGrant } from "./services/approvals";
import { getScaffolderTools } from "./services/agent-tools";
import { loadEnvSecrets } from "./services/secrets";
import { filterByTemplateAcl } from "./services/acl";

// Express router for the scaffolder HTTP API: templates, plans, apply, approvals, tasks, bindings, drift.

const planRequestSchema = z.object({
  templateId: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

const applyRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .optional();

const approveRequestSchema = z.object({
  capabilities: z.array(z.string().min(1)).min(1),
});

const driftPatchSchema = z.object({
  status: z.enum(["ignored", "applied", "superseded"]),
});

/** Persists a Plan to ScaffoldPlan and returns the row's id. */
async function persistPlan(
  plan: Plan,
  resolvedSteps: Array<{ stepId: string; action: string; input: unknown }>,
  createdByUserId: string,
  requestId: string | null,
): Promise<void> {
  await prisma.scaffoldPlan.create({
    data: {
      id: plan.id,
      templateId: plan.templateId,
      templateVersion: plan.templateVersion,
      templateHash: plan.templateContentHash,
      params: plan.params as never,
      paramsHash: plan.paramsHash,
      mode: plan.mode === "no-op" ? "no_op" : plan.mode,
      target: plan.target,
      capabilities: plan.capabilities,
      irreversible: plan.irreversible,
      bindingId: plan.bindingId,
      artifact: { steps: plan.steps, resolvedSteps } as never,
      requiresApproval: plan.requiresApproval as never,
      approvalsGranted: [] as never,
      createdByUserId,
      actorKind: plan.actor.kind,
      requestId,
      createdAt: new Date(plan.createdAt),
      expiresAt: new Date(plan.expiresAt),
    },
  });
}

interface PersistedPlanShape {
  plan: Plan;
  resolvedSteps: Array<{ stepId: string; action: string; input: unknown }>;
}

async function loadPlan(planId: string): Promise<PersistedPlanShape | null> {
  const row = await prisma.scaffoldPlan.findUnique({ where: { id: planId } });
  if (!row) return null;
  const artifact = row.artifact as unknown as {
    steps: Plan["steps"];
    resolvedSteps: Array<{ stepId: string; action: string; input: unknown }>;
  };
  const plan: Plan = {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateContentHash: row.templateHash,
    params: row.params as Record<string, unknown>,
    paramsHash: row.paramsHash,
    bindingId: row.bindingId,
    mode: row.mode === "no_op" ? "no-op" : row.mode,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    target: row.target as SandboxTarget,
    capabilities: row.capabilities as Plan["capabilities"],
    irreversible: row.irreversible,
    requiresApproval: row.requiresApproval as unknown as Plan["requiresApproval"],
    steps: artifact.steps,
    actor: {
      kind: row.actorKind as Plan["actor"]["kind"],
      userId: row.createdByUserId,
      teamIds: [],
    },
  };
  return { plan, resolvedSteps: artifact.resolvedSteps };
}

export function createScaffolderRouter(): Router {
  const router = Router();
  const templates = getTemplateRegistry();
  const actions = getActionRegistry();

  // GET /templates, list templates visible to the actor.
  router.get("/templates", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const visible = await filterByTemplateAcl(templates.list(), actor, isAdmin);
      res.json({
        items: visible.map((t) => ({
          id: t.metadata.id,
          version: t.metadata.version,
          name: t.metadata.name,
          description: t.metadata.description,
          tags: [...(t.metadata.tags ?? [])],
          icon: t.metadata.icon ?? null,
          audience: [...t.metadata.audience],
          requiredRole: t.metadata.requiredRole,
          capabilities: t.capabilities,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /templates/:id, full template detail with parameter JSON Schema.
  router.get("/templates/:id", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const tpl = templates.get(req.params.id!);
      if (!tpl) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const visible = await filterByTemplateAcl([tpl], actor, isAdmin);
      if (visible.length === 0) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      res.json({
        id: tpl.metadata.id,
        version: tpl.metadata.version,
        name: tpl.metadata.name,
        description: tpl.metadata.description,
        tags: [...(tpl.metadata.tags ?? [])],
        icon: tpl.metadata.icon ?? null,
        audience: [...tpl.metadata.audience],
        requiredRole: tpl.metadata.requiredRole,
        capabilities: tpl.capabilities,
        parametersJsonSchema: toJsonSchema(tpl.parameters),
        defaultTarget: tpl.resolvedDefaultTarget,
        planTtlSeconds: tpl.resolvedPlanTtlSeconds,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /plans, build and persist a Plan for a template + params.
  router.post("/plans", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const parsed = planRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
        return;
      }
      const tpl = templates.get(parsed.data.templateId);
      if (!tpl) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const visible = await filterByTemplateAcl([tpl], actor, isAdmin, true);
      if (visible.length === 0) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      const target = resolveTarget(tpl, "human");
      const planCtx = buildPlanCtx({ actor, target });

      const policy = loadCapabilityPolicy();
      const contentHash = templateContentHash({
        templateId: tpl.metadata.id,
        version: tpl.metadata.version,
        moduleSource: tpl.metadata.id + tpl.metadata.version,
      });
      const phash = computeParamsHash(parsed.data.params);
      const existingBinding = await prisma.scaffoldBinding.findFirst({
        where: { templateId: tpl.metadata.id, paramsHash: phash, active: true },
        select: { id: true },
      });

      const built = await buildPlan({
        template: tpl,
        rawParams: parsed.data.params,
        actor,
        ctx: planCtx,
        templateContentHash: contentHash,
        target,
        bindingId: existingBinding?.id ?? null,
        policy,
        actions,
      });

      await persistPlan(
        built.plan,
        built.resolvedSteps,
        actor.userId,
        req.id != null ? String(req.id) : null,
      );

      try {
        await prisma.auditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorIp: req.ip ?? null,
            requestId: req.id != null ? String(req.id) : null,
            kind: "scaffolder.plan.created",
            targetKind: "scaffolder.plan",
            targetId: built.plan.id,
            payload: {
              planId: built.plan.id,
              templateId: built.plan.templateId,
              templateVersion: built.plan.templateVersion,
              mode: built.plan.mode,
              target: built.plan.target,
              actorKind: actor.kind,
              requiresApproval: built.plan.requiresApproval.length,
            },
          },
        });
      } catch {
        // Audit failure must not block the response.
      }

      res.status(201).json(built.plan);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid params", issues: err.issues });
        return;
      }
      next(err);
    }
  });

  // GET /plans/:id
  router.get("/plans/:id", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const row = await prisma.scaffoldPlan.findUnique({ where: { id: req.params.id! } });
      if (!row) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }
      if (!isAdmin && row.createdByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const loaded = await loadPlan(row.id);
      res.json(loaded?.plan);
    } catch (err) {
      next(err);
    }
  });

  // POST /plans/:id/apply
  router.post("/plans/:id/apply", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const planRow = await prisma.scaffoldPlan.findUnique({ where: { id: req.params.id! } });
      if (!planRow) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      if (!isAdmin && planRow.createdByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const tplForApply = templates.get(planRow.templateId);
      if (tplForApply) {
        const canExec = await filterByTemplateAcl([tplForApply], actor, isAdmin, true);
        if (canExec.length === 0) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
      if (planRow.appliedTaskId) {
        res.status(409).json({ error: "Plan already applied", taskId: planRow.appliedTaskId });
        return;
      }
      const parsed = applyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
        return;
      }
      const dryRun = parsed.data?.dryRun ?? false;

      const loaded = await loadPlan(planRow.id);
      if (!loaded) {
        res.status(404).json({ error: "Plan artifact missing" });
        return;
      }
      const planCtx = buildPlanCtx({
        actor,
        target: loaded.plan.target,
      });

      const approvals = (planRow.approvalsGranted ?? []) as unknown as ApprovalGrant[];

      let result;
      try {
        result = await applyPlan({
          plan: loaded.plan,
          resolvedSteps: loaded.resolvedSteps,
          actions,
          planCtx,
          triggeredByUserId: actor.userId,
          dryRun,
          requestId: req.id != null ? String(req.id) : undefined,
          approvals,
          secrets: loadEnvSecrets(),
        });
      } catch (err) {
        if (err instanceof TargetLockBusyError) {
          res.status(409).json({ error: "Target busy" });
          return;
        }
        if (err instanceof StalePlanError) {
          res.status(409).json({ error: "Plan stale, replan required" });
          return;
        }
        if (err instanceof PlanExpiredError) {
          res.status(410).json({ error: "Plan expired" });
          return;
        }
        if (err instanceof ApprovalsMissingError) {
          res.status(403).json({
            error: "Approvals missing",
            missingCapabilities: err.missingCapabilities,
          });
          return;
        }
        throw err;
      }

      await prisma.scaffoldPlan.update({
        where: { id: planRow.id },
        data: { appliedTaskId: result.taskId },
      });

      try {
        await prisma.auditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorIp: req.ip ?? null,
            requestId: req.id != null ? String(req.id) : null,
            kind:
              result.status === "succeeded" ? "scaffolder.task.applied" : "scaffolder.task.failed",
            targetKind: "scaffolder.task",
            targetId: result.taskId,
            payload:
              result.status === "succeeded"
                ? {
                    taskId: result.taskId,
                    planId: planRow.id,
                    templateId: planRow.templateId,
                    status: result.status,
                    rolledBack: result.rolledBack,
                    durationMs: 0,
                  }
                : {
                    taskId: result.taskId,
                    planId: planRow.id,
                    templateId: planRow.templateId,
                    error: result.error ?? "unknown",
                  },
          },
        });
      } catch {
        // ignored
      }

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /approvals/:planId, admin grants capability approvals and refreshes expiresAt.
  router.post("/approvals/:planId", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      if (req.user?.role !== "admin") {
        res.status(403).json({ error: "Admin only" });
        return;
      }
      const parsed = approveRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
        return;
      }
      const planRow = await prisma.scaffoldPlan.findUnique({
        where: { id: req.params.planId! },
      });
      if (!planRow) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }
      const requiresApproval = planRow.requiresApproval as unknown as Plan["requiresApproval"];
      const requestedCaps = new Set(parsed.data.capabilities);
      const validCaps = requiresApproval.filter((r) => requestedCaps.has(r.capability));
      if (validCaps.length === 0) {
        res.status(400).json({ error: "No matching capabilities to approve" });
        return;
      }

      const tpl = templates.get(planRow.templateId);
      const ttlSeconds = tpl?.resolvedPlanTtlSeconds ?? 1800;
      const newExpires = new Date(Date.now() + ttlSeconds * 1000);

      const signer = createApprovalSigner();
      const existing = (planRow.approvalsGranted ?? []) as unknown as ApprovalGrant[];
      const existingCaps = new Set(existing.map((g) => g.capability));
      const newGrants = validCaps
        .filter((r) => !existingCaps.has(r.capability))
        .map((r) =>
          signer.sign({
            planId: planRow.id,
            capability: r.capability,
            approverUserId: actor.userId,
            approverIsAdmin: true,
            expiresAt: newExpires,
          }),
        );
      const allGrants = [...existing, ...newGrants];

      await prisma.scaffoldPlan.update({
        where: { id: planRow.id },
        data: {
          approvalsGranted: allGrants as never,
          expiresAt: newExpires,
        },
      });

      try {
        await prisma.auditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorIp: req.ip ?? null,
            requestId: req.id != null ? String(req.id) : null,
            kind: "scaffolder.approval.granted",
            targetKind: "scaffolder.plan",
            targetId: planRow.id,
            payload: {
              planId: planRow.id,
              capabilities: newGrants.map((g) => g.capability),
              approverUserId: actor.userId,
              expiresAt: newExpires.toISOString(),
            },
          },
        });
      } catch {
        // ignored
      }

      const refreshed = await loadPlan(planRow.id);
      res.json({
        plan: refreshed?.plan,
        approvalsGranted: allGrants,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id, task + steps + last 200 logs.
  router.get("/tasks/:id", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const task = await prisma.scaffoldTask.findUnique({
        where: { id: req.params.id! },
        include: {
          steps: { orderBy: { startedAt: "asc" } },
          logs: { orderBy: { createdAt: "desc" }, take: 200 },
        },
      });
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      if (!isAdmin && task.triggeredByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  // GET /tasks/:id/events, SSE stream.
  router.get("/tasks/:id/events", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const taskId = req.params.id!;
      const task = await prisma.scaffoldTask.findUnique({ where: { id: taskId } });
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      if (!isAdmin && task.triggeredByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      writeSse(res);
      const unsubscribe = taskEventBus.subscribe(taskId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.kind === "task.finished") {
          unsubscribe();
          res.end();
        }
      });
      // Already-finished task: replay terminal state once and close.
      if (task.finishedAt) {
        const event: Extract<StepEvent, { kind: "task.finished" }> = {
          kind: "task.finished",
          taskId,
          status: task.status,
          ...(task.error ? { error: task.error } : {}),
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        unsubscribe();
        res.end();
      }
      req.on("close", () => unsubscribe());
    } catch (err) {
      next(err);
    }
  });

  // GET /agent-tools, Anthropic SDK tool definitions for agent-runnable templates.
  router.get("/agent-tools", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      // ?as=agent lets an admin fetch the same tool list a back-end agent would see.
      const agentActor: typeof actor =
        req.query.as === "agent" ? { ...actor, kind: "agent" } : actor;
      const tools = await getScaffolderTools(agentActor, isAdmin);
      res.json({ items: tools });
    } catch (err) {
      next(err);
    }
  });

  // GET /bindings, own (member) or all (admin).
  router.get("/bindings", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const bindings = await prisma.scaffoldBinding.findMany({
        where: isAdmin ? undefined : { appliedByUserId: actor.userId },
        orderBy: { appliedAt: "desc" },
      });
      res.json({ items: bindings });
    } catch (err) {
      next(err);
    }
  });

  // POST /bindings/:id/replan, re-runs the template against stored params and returns an applyable Plan.
  router.post("/bindings/:id/replan", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const binding = await prisma.scaffoldBinding.findUnique({
        where: { id: req.params.id! },
      });
      if (!binding) {
        res.status(404).json({ error: "Binding not found" });
        return;
      }
      if (!isAdmin && binding.appliedByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const tpl = templates.get(binding.templateId);
      if (!tpl) {
        res.status(409).json({ error: "Template no longer registered" });
        return;
      }
      const target = resolveTarget(tpl, "human");
      const planCtx = buildPlanCtx({ actor, target });
      const policy = loadCapabilityPolicy();
      const contentHash = templateContentHash({
        templateId: tpl.metadata.id,
        version: tpl.metadata.version,
        moduleSource: tpl.metadata.id + tpl.metadata.version,
      });
      const built = await buildPlan({
        template: tpl,
        rawParams: binding.params,
        actor,
        ctx: planCtx,
        templateContentHash: contentHash,
        target,
        bindingId: binding.id,
        policy,
        actions,
      });
      await persistPlan(
        built.plan,
        built.resolvedSteps,
        actor.userId,
        req.id != null ? String(req.id) : null,
      );
      try {
        await prisma.auditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorIp: req.ip ?? null,
            requestId: req.id != null ? String(req.id) : null,
            kind: "scaffolder.binding.replanned",
            targetKind: "scaffolder.binding",
            targetId: binding.id,
            payload: {
              bindingId: binding.id,
              templateId: binding.templateId,
              fromVersion: binding.templateVersion,
              toVersion: tpl.metadata.version,
              planId: built.plan.id,
            },
          },
        });
      } catch {
        // ignored
      }
      res.status(201).json(built.plan);
    } catch (err) {
      next(err);
    }
  });

  // GET /drift/summary, open drift counts grouped by binding (members see own, admins see all).
  router.get("/drift/summary", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const bindingIdFilter =
        typeof req.query.bindingId === "string" && req.query.bindingId.length > 0
          ? req.query.bindingId
          : undefined;
      const templateIdFilter =
        typeof req.query.templateId === "string" && req.query.templateId.length > 0
          ? req.query.templateId
          : undefined;
      const bindingWhere: Record<string, unknown> = {};
      if (!isAdmin) bindingWhere.appliedByUserId = actor.userId;
      if (templateIdFilter) bindingWhere.templateId = templateIdFilter;
      const drifts = await prisma.scaffoldDrift.findMany({
        where: {
          status: "open",
          ...(bindingIdFilter ? { bindingId: bindingIdFilter } : {}),
          ...(Object.keys(bindingWhere).length > 0 ? { binding: bindingWhere } : {}),
        },
        include: {
          binding: {
            select: { id: true, targetRef: true, templateId: true },
          },
        },
        orderBy: { detectedAt: "desc" },
        take: 200,
      });
      const grouped = new Map<
        string,
        {
          bindingId: string;
          targetRef: string;
          templateId: string;
          drifts: Array<{
            id: string;
            fromVersion: string;
            toVersion: string;
            detectedAt: string;
            actions: string[];
          }>;
        }
      >();
      for (const d of drifts) {
        const summary = (d.diffSummary as { actions?: unknown }) ?? {};
        const actions = Array.isArray(summary.actions)
          ? (summary.actions as unknown[]).filter((a): a is string => typeof a === "string")
          : [];
        const existing = grouped.get(d.bindingId);
        const entry = {
          id: d.id,
          fromVersion: d.fromVersion,
          toVersion: d.toVersion,
          detectedAt: d.detectedAt.toISOString(),
          actions,
        };
        if (existing) {
          existing.drifts.push(entry);
        } else {
          grouped.set(d.bindingId, {
            bindingId: d.bindingId,
            targetRef: d.binding.targetRef,
            templateId: d.binding.templateId,
            drifts: [entry],
          });
        }
      }
      res.json({ openCount: drifts.length, byBinding: Array.from(grouped.values()) });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /drift/:id, update drift status (binding owner or admin).
  router.patch("/drift/:id", async (req, res, next) => {
    try {
      const actor = await actorFromRequest(req);
      if (!actor) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isAdmin = req.user?.role === "admin";
      const parsed = driftPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
        return;
      }
      const drift = await prisma.scaffoldDrift.findUnique({
        where: { id: req.params.id! },
        include: { binding: { select: { appliedByUserId: true } } },
      });
      if (!drift) {
        res.status(404).json({ error: "Drift not found" });
        return;
      }
      if (!isAdmin && drift.binding.appliedByUserId !== actor.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const updated = await prisma.scaffoldDrift.update({
        where: { id: drift.id },
        data: {
          status: parsed.data.status,
          resolvedAt: new Date(),
        },
      });
      try {
        await prisma.auditEvent.create({
          data: {
            actorUserId: actor.userId,
            actorIp: req.ip ?? null,
            requestId: req.id != null ? String(req.id) : null,
            kind: "scaffolder.drift.resolved",
            targetKind: "scaffolder.drift",
            targetId: drift.id,
            payload: {
              driftId: drift.id,
              bindingId: drift.bindingId,
              status: parsed.data.status,
            },
          },
        });
      } catch {
        // ignored
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function writeSse(res: Response): void {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(":\n\n"); // open the stream
}
