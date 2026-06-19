// Teams backend helpers: Prisma include shapes, DTO mappers, and shared utilities for team routes.
import { Prisma, prisma } from "@internal/db";
import type { Request } from "express";
import type { TeamDetail, TeamMembership, TeamSummary } from "@feature/teams-shared";

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
