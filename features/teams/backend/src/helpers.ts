// Teams backend helpers: Prisma include shapes, DTO mappers, and shared utilities for team/request routes.
import { Prisma, prisma } from "@internal/db";
import type { Request } from "express";
import type {
  MaintainerRequestDto,
  TeamDetail,
  TeamMembership,
  TeamSummary,
  TeamRequestDto,
} from "@internal/shared-types";

export const TEAM_DETAIL_INCLUDE = {
  memberships: { include: { user: true }, orderBy: { joinedAt: "asc" } },
} satisfies Prisma.TeamInclude;

type TeamDetailRow = Prisma.TeamGetPayload<{ include: typeof TEAM_DETAIL_INCLUDE }>;

export function shapeMembership(m: TeamDetailRow["memberships"][number]): TeamMembership {
  return {
    teamId: m.teamId,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    displayName: m.user.displayName,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
  };
}

function findLeads(rows: TeamDetailRow["memberships"]) {
  return rows
    .filter((m) => m.role === "lead")
    .map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    }));
}

export function shapeTeamDetail(team: TeamDetailRow): TeamDetail {
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    accountLogin: team.accountLogin,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
    memberCount: team.memberships.length,
    leads: findLeads(team.memberships),
    members: team.memberships.map(shapeMembership),
  };
}

export function shapeTeamSummary(team: TeamDetailRow): TeamSummary {
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    accountLogin: team.accountLogin,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
    memberCount: team.memberships.length,
    leads: findLeads(team.memberships),
  };
}

/** Returns true if the actor is admin OR holds the `lead` role on the team. */
export async function isTeamManager(req: Request, teamId: string): Promise<boolean> {
  const actor = req.user;
  if (!actor) return false;
  if (actor.role === "admin") return true;
  const lead = await prisma.teamMembership.findFirst({
    where: { teamId, userId: actor.id, role: "lead" },
    select: { teamId: true },
  });
  return !!lead;
}

export async function loadTeamBySlug(slug: string, opts: { includeDeleted?: boolean } = {}) {
  return prisma.team.findFirst({
    where: { slug, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: TEAM_DETAIL_INCLUDE,
  });
}

export type TeamRequestRow = Prisma.TeamRequestGetPayload<{
  include: {
    requestedBy: true;
    reviewedBy: true;
    createdTeam: true;
    githubIntegration: true;
  };
}>;

export const TEAM_REQUEST_INCLUDE = {
  requestedBy: true,
  reviewedBy: true,
  createdTeam: true,
  githubIntegration: true,
} satisfies Prisma.TeamRequestInclude;

/** Pulls the public org login out of an Integration's config without exposing other fields. */
export function readGithubOrgLogin(
  integration: Prisma.IntegrationGetPayload<true> | null,
): string | null {
  if (!integration) return null;
  const cfg = integration.config;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const login = (cfg as Record<string, unknown>).accountLogin;
  return typeof login === "string" && login.length > 0 ? login : null;
}

export type ProposedUserMap = Map<string, { displayName: string; avatarUrl: string | null }>;

/** Resolve the union of proposed maintainer + member ids across many requests in a single query. */
export async function loadProposedUserMap(rows: TeamRequestRow[]): Promise<ProposedUserMap> {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const id of r.proposedMaintainerUserIds) ids.add(id);
    for (const id of r.proposedMemberUserIds) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true, avatarUrl: true },
  });
  return new Map(users.map((u) => [u.id, { displayName: u.displayName, avatarUrl: u.avatarUrl }]));
}

function resolveProposed(
  ids: string[],
  userMap: ProposedUserMap | undefined,
): TeamRequestDto["proposedMaintainers"] {
  if (!userMap) return [];
  const out: TeamRequestDto["proposedMaintainers"] = [];
  for (const id of ids) {
    const u = userMap.get(id);
    if (!u) continue; // user deleted between submit and now, silently drop
    out.push({ userId: id, displayName: u.displayName, avatarUrl: u.avatarUrl });
  }
  return out;
}

export function shapeTeamRequest(r: TeamRequestRow, userMap?: ProposedUserMap): TeamRequestDto {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    status: r.status,
    mirrorToGithub: r.mirrorToGithub,
    githubIntegrationId: r.githubIntegrationId,
    githubOrgLogin: readGithubOrgLogin(r.githubIntegration),
    roundCount: r.roundCount,
    lastEditedByUserId: r.lastEditedByUserId,
    autoCancelReason: r.autoCancelReason,
    original: {
      slug: r.originalSlug,
      name: r.originalName,
      description: r.originalDescription,
      mirrorToGithub: r.originalMirrorToGithub,
      githubIntegrationId: r.originalGithubIntegrationId,
    },
    rejectionReason: r.rejectionReason,
    createdTeamId: r.createdTeamId,
    createdTeamSlug: r.createdTeam?.slug ?? null,
    proposedMaintainers: resolveProposed(r.proposedMaintainerUserIds, userMap),
    proposedMembers: resolveProposed(r.proposedMemberUserIds, userMap),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    requestedBy: {
      userId: r.requestedBy.id,
      displayName: r.requestedBy.displayName,
      avatarUrl: r.requestedBy.avatarUrl,
    },
    reviewedBy: r.reviewedBy
      ? {
          userId: r.reviewedBy.id,
          displayName: r.reviewedBy.displayName,
          avatarUrl: r.reviewedBy.avatarUrl,
        }
      : null,
  };
}

export type MaintainerRequestRow = Prisma.MaintainerRequestGetPayload<{
  include: {
    requestedBy: true;
    reviewedBy: true;
    team: true;
  };
}>;

export const MAINTAINER_REQUEST_INCLUDE = {
  requestedBy: true,
  reviewedBy: true,
  team: true,
} satisfies Prisma.MaintainerRequestInclude;

export function shapeMaintainerRequest(r: MaintainerRequestRow): MaintainerRequestDto {
  return {
    id: r.id,
    teamId: r.teamId,
    teamSlug: r.team.slug,
    teamName: r.team.name,
    status: r.status,
    reason: r.reason,
    rejectionReason: r.rejectionReason,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    requestedBy: {
      userId: r.requestedBy.id,
      displayName: r.requestedBy.displayName,
      avatarUrl: r.requestedBy.avatarUrl,
    },
    reviewedBy: r.reviewedBy
      ? {
          userId: r.reviewedBy.id,
          displayName: r.reviewedBy.displayName,
          avatarUrl: r.reviewedBy.avatarUrl,
        }
      : null,
  };
}

/** Days until a pending request auto-expires. */
export const REQUEST_TTL_DAYS = 30;

export function requestExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function audit(
  tx: Prisma.TransactionClient,
  req: Request,
  kind: string,
  payload: Record<string, unknown>,
  target: { kind: string; id: string },
) {
  return tx.auditEvent.create({
    data: {
      actorUserId: req.user?.id ?? null,
      actorIp: req.ip ?? null,
      requestId: req.id != null ? String(req.id) : null,
      kind,
      targetKind: target.kind,
      targetId: target.id,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}
