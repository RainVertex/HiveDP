// REST surface for the Pipelines tab, mounted entity-scoped under /api/catalog/:id/* behind the org gate, refresh additionally needs admin/member.

import { Router } from "express";
import { prisma } from "@internal/db";
import type {
  WorkflowRunRow,
  WorkflowRunConclusion,
  WorkflowRunStatus,
  DeploymentRow,
  DeploymentState,
} from "@internal/shared-types";
import { requireEntityOrgAccess } from "../access";
import { syncEntityPipelines } from "./sync";

export const pipelinesRouter: Router = Router({ mergeParams: true });

pipelinesRouter.get("/:id/pipeline-runs", requireEntityOrgAccess(), async (req, res) => {
  const entityId = req.params.id;

  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;

  const rows = await prisma.workflowRun.findMany({
    where: { entityId, ...(branch ? { headBranch: branch } : {}) },
    orderBy: { runUpdatedAt: "desc" },
    take: limit,
  });

  const items: WorkflowRunRow[] = rows.map((r) => ({
    id: r.id,
    workflowName: r.workflowName,
    workflowPath: r.workflowPath,
    runNumber: r.runNumber,
    event: r.event,
    status: r.status as WorkflowRunStatus,
    conclusion: r.conclusion as WorkflowRunConclusion | null,
    headBranch: r.headBranch,
    headSha: r.headSha,
    actorLogin: r.actorLogin,
    htmlUrl: r.htmlUrl,
    runStartedAt: r.runStartedAt ? r.runStartedAt.toISOString() : null,
    runUpdatedAt: r.runUpdatedAt ? r.runUpdatedAt.toISOString() : null,
  }));
  res.json({ items });
});

pipelinesRouter.get("/:id/deployments", requireEntityOrgAccess(), async (req, res) => {
  const entityId = req.params.id;

  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const environment = typeof req.query.environment === "string" ? req.query.environment : undefined;

  const rows = await prisma.deployment.findMany({
    where: { entityId, ...(environment ? { environment } : {}) },
    orderBy: { deployedAt: "desc" },
    take: limit,
  });

  const items: DeploymentRow[] = rows.map((d) => ({
    id: d.id,
    environment: d.environment,
    ref: d.ref,
    sha: d.sha,
    state: d.state as DeploymentState,
    actorLogin: d.actorLogin,
    description: d.description,
    htmlUrl: d.htmlUrl,
    logUrl: d.logUrl,
    deployedAt: d.deployedAt ? d.deployedAt.toISOString() : null,
  }));
  res.json({ items });
});

pipelinesRouter.post("/:id/pipelines/refresh", requireEntityOrgAccess(), async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (req.user.role !== "admin" && req.user.role !== "member") {
      res.status(403).json({ error: "Admin or member only" });
      return;
    }
    const entityId = req.params.id;

    const result = await syncEntityPipelines(entityId);
    await prisma.auditEvent.create({
      data: {
        actorUserId: req.user.id,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
        kind: "catalog.pipelines.refresh",
        targetKind: "catalog_entity",
        targetId: entityId,
        payload: {
          entityId,
          runsUpserted: result.runsUpserted,
          deploymentsUpserted: result.deploymentsUpserted,
          error: result.error,
        },
      },
    });

    if (result.error) {
      res.status(502).json({ ok: false, error: result.error, partial: result });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});
