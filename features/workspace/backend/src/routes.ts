// Workspace REST endpoints. Read-only over the Plane mirror in Phase A;
// write-through proxies to Plane will be added in Phase B. Every endpoint
// requires an authenticated session (mounted under requireAuth in
// createServer.ts via /api).

import { Router } from "express";
import { prisma } from "@internal/db";
import type {
  MyWorkDto,
  PlaneCommentDto,
  PlaneCycleDto,
  PlaneIntegrationStatusDto,
  PlaneLabelDto,
  PlaneMemberDto,
  PlaneModuleDto,
  PlaneProjectDto,
  PlaneStateDto,
  PlaneUserMappingDto,
  PlaneWorkItemDetailDto,
  PlaneWorkItemSummaryDto,
} from "@internal/shared-types";
import { fullSync } from "./sync/engine";

export const workspaceRoutes: Router = Router();

// -------- Integrations -------------------------------------------------------

workspaceRoutes.get("/integrations", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const integrations = await prisma.integration.findMany({
    where: { kind: "plane" },
    select: {
      id: true,
      name: true,
      enabled: true,
      config: true,
      planeWorkspaces: {
        select: { id: true, name: true, slug: true },
        take: 1,
      },
      planeSyncCursor: {
        select: { lastFullSyncAt: true, lastWebhookAt: true },
      },
    },
  });

  const items: PlaneIntegrationStatusDto[] = await Promise.all(
    integrations.map(async (i) => {
      const ws = i.planeWorkspaces[0] ?? null;
      const [projectCount, memberCount, mappedCount] = await Promise.all([
        prisma.planeProject.count({ where: { integrationId: i.id, archivedAt: null } }),
        ws ? prisma.planeMember.count({ where: { workspaceId: ws.id } }) : Promise.resolve(0),
        ws
          ? prisma.planeUserMapping.count({ where: { member: { workspaceId: ws.id } } })
          : Promise.resolve(0),
      ]);
      const cfg = (i.config ?? {}) as Record<string, unknown>;
      const slug = typeof cfg.workspaceSlug === "string" ? cfg.workspaceSlug : (ws?.slug ?? "");
      return {
        integrationId: i.id,
        name: i.name,
        enabled: i.enabled,
        workspaceSlug: slug,
        workspaceName: ws?.name ?? null,
        lastFullSyncAt: i.planeSyncCursor?.lastFullSyncAt?.toISOString() ?? null,
        lastWebhookAt: i.planeSyncCursor?.lastWebhookAt?.toISOString() ?? null,
        projectCount,
        memberCount,
        unmappedMemberCount: memberCount - mappedCount,
        hasWebhookSecret: typeof cfg.webhookSecret === "string" && cfg.webhookSecret.length > 0,
      };
    }),
  );
  res.json({ items });
});

workspaceRoutes.get("/integrations/:id", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const integration = await prisma.integration.findFirst({
    where: { id: req.params.id, kind: "plane" },
    select: {
      id: true,
      name: true,
      enabled: true,
      config: true,
      planeWorkspaces: { select: { id: true, name: true, slug: true } },
      planeSyncCursor: { select: { lastFullSyncAt: true, lastWebhookAt: true } },
    },
  });
  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }
  const ws = integration.planeWorkspaces[0] ?? null;
  const [projectCount, memberCount, mappedCount] = await Promise.all([
    prisma.planeProject.count({ where: { integrationId: integration.id, archivedAt: null } }),
    ws ? prisma.planeMember.count({ where: { workspaceId: ws.id } }) : Promise.resolve(0),
    ws
      ? prisma.planeUserMapping.count({ where: { member: { workspaceId: ws.id } } })
      : Promise.resolve(0),
  ]);
  const cfg = (integration.config ?? {}) as Record<string, unknown>;
  const status: PlaneIntegrationStatusDto = {
    integrationId: integration.id,
    name: integration.name,
    enabled: integration.enabled,
    workspaceSlug: typeof cfg.workspaceSlug === "string" ? cfg.workspaceSlug : (ws?.slug ?? ""),
    workspaceName: ws?.name ?? null,
    lastFullSyncAt: integration.planeSyncCursor?.lastFullSyncAt?.toISOString() ?? null,
    lastWebhookAt: integration.planeSyncCursor?.lastWebhookAt?.toISOString() ?? null,
    projectCount,
    memberCount,
    unmappedMemberCount: memberCount - mappedCount,
    hasWebhookSecret: typeof cfg.webhookSecret === "string" && cfg.webhookSecret.length > 0,
  };
  res.json(status);
});

workspaceRoutes.post("/integrations/:id/sync", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const integrationId = req.params.id;
  try {
    const result = await fullSync(integrationId);
    res.json({ status: "ok", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    res.status(500).json({ error: message });
  }
});

// -------- Members + user mapping --------------------------------------------

workspaceRoutes.get("/integrations/:id/members", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const integration = await prisma.integration.findFirst({
    where: { id: req.params.id, kind: "plane" },
    select: { id: true, planeWorkspaces: { select: { id: true } } },
  });
  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }
  const ws = integration.planeWorkspaces[0];
  if (!ws) {
    res.json({ mappings: [], unmappedMembers: [] });
    return;
  }
  const [members, mappings] = await Promise.all([
    prisma.planeMember.findMany({ where: { workspaceId: ws.id } }),
    prisma.planeUserMapping.findMany({
      where: { member: { workspaceId: ws.id } },
      include: {
        member: true,
        user: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      },
    }),
  ]);
  const mappedMemberIds = new Set(mappings.map((m) => m.planeMemberId));
  const unmappedMembers: PlaneMemberDto[] = members
    .filter((m) => !mappedMemberIds.has(m.id))
    .map((m) => ({
      id: m.id,
      externalId: m.externalId,
      email: m.email,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
    }));
  const dtoMappings: PlaneUserMappingDto[] = mappings.map((m) => ({
    id: m.id,
    platformUserId: m.platformUserId,
    planeMemberId: m.planeMemberId,
    member: {
      id: m.member.id,
      externalId: m.member.externalId,
      email: m.member.email,
      displayName: m.member.displayName,
      avatarUrl: m.member.avatarUrl,
    },
    user: {
      id: m.user.id,
      displayName: m.user.displayName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
    },
    createdAt: m.createdAt.toISOString(),
  }));
  res.json({ mappings: dtoMappings, unmappedMembers });
});

workspaceRoutes.post("/integrations/:id/mappings", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const platformUserId = String(req.body?.platformUserId ?? "");
  const planeMemberId = String(req.body?.planeMemberId ?? "");
  if (!platformUserId || !planeMemberId) {
    res.status(400).json({ error: "platformUserId and planeMemberId are required" });
    return;
  }
  // Verify the member belongs to this integration's workspace.
  const member = await prisma.planeMember.findFirst({
    where: {
      id: planeMemberId,
      workspace: { integrationId: req.params.id },
    },
  });
  if (!member) {
    res.status(404).json({ error: "Member not found in this integration" });
    return;
  }
  const mapping = await prisma.planeUserMapping.upsert({
    where: { platformUserId_planeMemberId: { platformUserId, planeMemberId } },
    create: { platformUserId, planeMemberId },
    update: {},
    include: {
      member: true,
      user: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
    },
  });
  const dto: PlaneUserMappingDto = {
    id: mapping.id,
    platformUserId: mapping.platformUserId,
    planeMemberId: mapping.planeMemberId,
    member: {
      id: mapping.member.id,
      externalId: mapping.member.externalId,
      email: mapping.member.email,
      displayName: mapping.member.displayName,
      avatarUrl: mapping.member.avatarUrl,
    },
    user: {
      id: mapping.user.id,
      displayName: mapping.user.displayName,
      email: mapping.user.email,
      avatarUrl: mapping.user.avatarUrl,
    },
    createdAt: mapping.createdAt.toISOString(),
  };
  res.json(dto);
});

workspaceRoutes.delete("/integrations/:id/mappings/:mappingId", async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  await prisma.planeUserMapping.delete({ where: { id: req.params.mappingId } });
  res.status(204).end();
});

// -------- Projects -----------------------------------------------------------

workspaceRoutes.get("/projects", async (req, res) => {
  const integrationId =
    typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
  const archivedFlag =
    typeof req.query.archived === "string" ? req.query.archived === "true" : undefined;
  const projects = await prisma.planeProject.findMany({
    where: {
      ...(integrationId ? { integrationId } : {}),
      archivedAt: archivedFlag === true ? { not: null } : archivedFlag === false ? null : undefined,
    },
    orderBy: { name: "asc" },
  });
  const ids = projects.map((p) => p.id);
  const [allCounts, openCounts] = await Promise.all([
    ids.length
      ? prisma.planeWorkItem.groupBy({
          by: ["projectId"],
          where: { projectId: { in: ids } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.planeWorkItem.groupBy({
          by: ["projectId"],
          where: { projectId: { in: ids }, completedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const allMap = new Map(allCounts.map((c) => [c.projectId, c._count._all]));
  const openMap = new Map(openCounts.map((c) => [c.projectId, c._count._all]));
  const items: PlaneProjectDto[] = projects.map((p) => ({
    id: p.id,
    integrationId: p.integrationId,
    workspaceId: p.workspaceId,
    externalId: p.externalId,
    identifier: p.identifier,
    name: p.name,
    description: p.description,
    emoji: p.emoji,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
    workItemCount: allMap.get(p.id) ?? 0,
    openWorkItemCount: openMap.get(p.id) ?? 0,
  }));
  res.json({ items });
});

workspaceRoutes.get("/projects/:id", async (req, res) => {
  const project = await prisma.planeProject.findUnique({
    where: { id: req.params.id },
    include: {
      states: { orderBy: { order: "asc" } },
      labels: { orderBy: { name: "asc" } },
      cycles: { orderBy: { startDate: "desc" } },
      modules: { orderBy: { name: "asc" } },
    },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const states: PlaneStateDto[] = project.states.map((s) => ({
    id: s.id,
    externalId: s.externalId,
    name: s.name,
    color: s.color,
    group: s.group,
    order: s.order,
    isDefault: s.isDefault,
  }));
  const labels: PlaneLabelDto[] = project.labels.map((l) => ({
    id: l.id,
    externalId: l.externalId,
    name: l.name,
    color: l.color,
  }));
  const cycles: PlaneCycleDto[] = project.cycles.map((c) => ({
    id: c.id,
    externalId: c.externalId,
    name: c.name,
    startDate: c.startDate?.toISOString() ?? null,
    endDate: c.endDate?.toISOString() ?? null,
  }));
  const modules: PlaneModuleDto[] = project.modules.map((m) => ({
    id: m.id,
    externalId: m.externalId,
    name: m.name,
    status: m.status,
  }));
  res.json({
    id: project.id,
    integrationId: project.integrationId,
    workspaceId: project.workspaceId,
    externalId: project.externalId,
    identifier: project.identifier,
    name: project.name,
    description: project.description,
    emoji: project.emoji,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
    states,
    labels,
    cycles,
    modules,
  });
});

// -------- Work items ---------------------------------------------------------

workspaceRoutes.get("/projects/:id/work-items", async (req, res) => {
  const projectId = req.params.id;
  const stateGroup = typeof req.query.stateGroup === "string" ? req.query.stateGroup : undefined;
  const assigneeId = typeof req.query.assigneeId === "string" ? req.query.assigneeId : undefined;

  const items = await prisma.planeWorkItem.findMany({
    where: {
      projectId,
      ...(stateGroup ? { state: { group: stateGroup } } : {}),
      ...(assigneeId ? { assigneeIds: { has: assigneeId } } : {}),
    },
    include: { state: true },
    orderBy: { sequenceId: "asc" },
  });
  res.json({ items: items.map(toWorkItemSummary) });
});

workspaceRoutes.get("/work-items/:id", async (req, res) => {
  const item = await prisma.planeWorkItem.findUnique({
    where: { id: req.params.id },
    include: {
      state: true,
      project: { select: { id: true, identifier: true, name: true, workspaceId: true } },
      parent: {
        include: { state: true, project: { select: { id: true, identifier: true, name: true } } },
      },
      subItems: {
        include: { state: true, project: { select: { id: true, identifier: true, name: true } } },
        orderBy: { sequenceId: "asc" },
      },
      comments: { orderBy: { externalCreatedAt: "asc" } },
    },
  });
  if (!item) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  const authorMap = await hydrateCommentAuthors(item.project.workspaceId, item.comments);
  const detail: PlaneWorkItemDetailDto = {
    ...toWorkItemSummary(item),
    description: item.description,
    parentId: item.parentId,
    cycleId: item.cycleId,
    moduleId: item.moduleId,
    parent: item.parent ? toWorkItemSummary(item.parent) : null,
    subItems: item.subItems.map(toWorkItemSummary),
    comments: item.comments.map((c) =>
      toCommentDto(c, c.authorExternalId ? (authorMap.get(c.authorExternalId) ?? null) : null),
    ),
  };
  res.json(detail);
});

workspaceRoutes.get("/work-items/:id/comments", async (req, res) => {
  const workItem = await prisma.planeWorkItem.findUnique({
    where: { id: req.params.id },
    select: { project: { select: { workspaceId: true } } },
  });
  if (!workItem) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  const comments = await prisma.planeComment.findMany({
    where: { workItemId: req.params.id },
    orderBy: { externalCreatedAt: "asc" },
  });
  const authorMap = await hydrateCommentAuthors(workItem.project.workspaceId, comments);
  res.json({
    items: comments.map((c) =>
      toCommentDto(c, c.authorExternalId ? (authorMap.get(c.authorExternalId) ?? null) : null),
    ),
  });
});

// -------- My-work aggregator -------------------------------------------------

workspaceRoutes.get("/my-work", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const integrations = await prisma.integration.findMany({
    where: { kind: "plane", enabled: true },
    select: { id: true },
  });
  if (integrations.length === 0) {
    res.json({
      myOpenWorkItems: [],
      recentProjects: [],
      needsIntegration: true,
      needsUserMapping: false,
    } satisfies MyWorkDto);
    return;
  }

  const mappings = await prisma.planeUserMapping.findMany({
    where: { platformUserId: req.user.id },
    include: { member: { select: { externalId: true, workspaceId: true } } },
  });
  if (mappings.length === 0) {
    const recentProjects = await prisma.planeProject.findMany({
      where: { archivedAt: null },
      orderBy: { lastSyncedAt: "desc" },
      take: 8,
    });
    res.json({
      myOpenWorkItems: [],
      recentProjects: recentProjects.map(toProjectDto),
      needsIntegration: false,
      needsUserMapping: true,
    } satisfies MyWorkDto);
    return;
  }

  const planeMemberExternalIds = mappings.map((m) => m.member.externalId);
  const myItems = await prisma.planeWorkItem.findMany({
    where: {
      assigneeIds: { hasSome: planeMemberExternalIds },
      completedAt: null,
    },
    include: {
      state: true,
      project: {
        select: {
          id: true,
          identifier: true,
          name: true,
          externalId: true,
          integrationId: true,
        },
      },
    },
    orderBy: [{ targetDate: "asc" }, { externalUpdatedAt: "desc" }],
    take: 50,
  });

  const projectIds = Array.from(new Set(myItems.map((w) => w.projectId)));
  const projects = await prisma.planeProject.findMany({
    where: { id: { in: projectIds } },
  });

  const integrationIds = Array.from(new Set(myItems.map((w) => w.project.integrationId)));
  const integrationRows = await prisma.integration.findMany({
    where: { id: { in: integrationIds }, kind: "plane" },
    select: { id: true, config: true },
  });
  const linkBaseByIntegrationId = new Map<string, string>();
  for (const i of integrationRows) {
    const cfg =
      (i.config as { baseUrl?: unknown; webUrl?: unknown; workspaceSlug?: unknown }) ?? {};
    const host = typeof cfg.webUrl === "string" ? cfg.webUrl : cfg.baseUrl;
    if (typeof host === "string" && typeof cfg.workspaceSlug === "string") {
      linkBaseByIntegrationId.set(
        i.id,
        `${host.replace(/\/+$/, "")}/${cfg.workspaceSlug}/projects`,
      );
    }
  }

  res.json({
    myOpenWorkItems: myItems.map((w) => {
      const summary = toWorkItemSummary(w);
      const base = linkBaseByIntegrationId.get(w.project.integrationId);
      if (base) {
        summary.planeUrl = `${base}/${w.project.externalId}/issues/${w.externalId}`;
      }
      return summary;
    }),
    recentProjects: projects.map(toProjectDto),
    needsIntegration: false,
    needsUserMapping: false,
  } satisfies MyWorkDto);
});

// -------- Mappers ------------------------------------------------------------

function toProjectDto(p: {
  id: string;
  integrationId: string;
  workspaceId: string;
  externalId: string;
  identifier: string;
  name: string;
  description: string | null;
  emoji: string | null;
  archivedAt: Date | null;
  lastSyncedAt: Date | null;
}): PlaneProjectDto {
  return {
    id: p.id,
    integrationId: p.integrationId,
    workspaceId: p.workspaceId,
    externalId: p.externalId,
    identifier: p.identifier,
    name: p.name,
    description: p.description,
    emoji: p.emoji,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
  };
}

interface WorkItemRow {
  id: string;
  projectId: string;
  externalId: string;
  sequenceId: number;
  name: string;
  state: {
    id: string;
    externalId: string;
    name: string;
    color: string | null;
    group: string;
    order: number;
    isDefault: boolean;
  } | null;
  priority: string;
  assigneeIds: string[];
  labelIds: string[];
  startDate: Date | null;
  targetDate: Date | null;
  completedAt: Date | null;
  externalCreatedAt: Date;
  externalUpdatedAt: Date;
  project?: { id: string; identifier: string; name: string } | null;
}

function toWorkItemSummary(w: WorkItemRow): PlaneWorkItemSummaryDto {
  return {
    id: w.id,
    projectId: w.projectId,
    externalId: w.externalId,
    sequenceId: w.sequenceId,
    name: w.name,
    state: w.state
      ? {
          id: w.state.id,
          externalId: w.state.externalId,
          name: w.state.name,
          color: w.state.color,
          group: w.state.group,
          order: w.state.order,
          isDefault: w.state.isDefault,
        }
      : null,
    priority: w.priority,
    assigneeIds: w.assigneeIds,
    labelIds: w.labelIds,
    startDate: w.startDate?.toISOString() ?? null,
    targetDate: w.targetDate?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    externalCreatedAt: w.externalCreatedAt.toISOString(),
    externalUpdatedAt: w.externalUpdatedAt.toISOString(),
    project: w.project ?? null,
  };
}

type CommentAuthor = { displayName: string; email: string; avatarUrl: string | null };

function toCommentDto(
  c: {
    id: string;
    workItemId: string;
    externalId: string;
    authorExternalId: string | null;
    body: string;
    externalCreatedAt: Date;
    externalUpdatedAt: Date;
  },
  author: CommentAuthor | null = null,
): PlaneCommentDto {
  return {
    id: c.id,
    workItemId: c.workItemId,
    externalId: c.externalId,
    authorExternalId: c.authorExternalId,
    author,
    body: c.body,
    externalCreatedAt: c.externalCreatedAt.toISOString(),
    externalUpdatedAt: c.externalUpdatedAt.toISOString(),
  };
}

async function hydrateCommentAuthors(
  workspaceId: string,
  comments: Array<{ authorExternalId: string | null }>,
): Promise<Map<string, CommentAuthor>> {
  const ids = Array.from(
    new Set(comments.map((c) => c.authorExternalId).filter((id): id is string => Boolean(id))),
  );
  if (ids.length === 0) return new Map();
  const members = await prisma.planeMember.findMany({
    where: { workspaceId, externalId: { in: ids } },
    select: { externalId: true, displayName: true, email: true, avatarUrl: true },
  });
  return new Map(
    members.map((m) => [
      m.externalId,
      { displayName: m.displayName, email: m.email, avatarUrl: m.avatarUrl },
    ]),
  );
}
