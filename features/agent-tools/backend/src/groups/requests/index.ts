import { prisma } from "@internal/db";
import type { RegisteredTool } from "@internal/llm-core";
import type { ToolGroup } from "../../types";
import { requireUserId } from "../core";

const myPending: RegisteredTool = {
  id: "requests_my_pending",
  openaiDef: {
    type: "function",
    function: {
      name: "requests_my_pending",
      description:
        "Summarize the current user's pending self-service requests across types: team-creation requests they submitted, team-creation requests awaiting their response, and pending maintainer-promotion requests.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);

    const teamRequestsAwaitingMe = await prisma.teamRequest.findMany({
      where: { requestedByUserId: userId, status: "awaiting_user_confirmation" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, name: true, status: true, roundCount: true, updatedAt: true },
    });
    const teamRequestsPending = await prisma.teamRequest.findMany({
      where: { requestedByUserId: userId, status: "pending" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, name: true, status: true, roundCount: true, updatedAt: true },
    });
    const maintainerRequestsPending = await prisma.maintainerRequest.findMany({
      where: { requestedByUserId: userId, status: "pending" },
      include: { team: { select: { slug: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return {
      teamRequestsAwaitingMe: teamRequestsAwaitingMe.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        roundCount: r.roundCount,
        updatedAt: r.updatedAt.toISOString(),
      })),
      teamRequestsPending: teamRequestsPending.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        roundCount: r.roundCount,
        updatedAt: r.updatedAt.toISOString(),
      })),
      maintainerRequestsPending: maintainerRequestsPending.map((r) => ({
        id: r.id,
        teamSlug: r.team.slug,
        teamName: r.team.name,
        reason: r.reason,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  },
};

const myTeamRequests: RegisteredTool = {
  id: "requests_my_team_requests",
  openaiDef: {
    type: "function",
    function: {
      name: "requests_my_team_requests",
      description:
        "List all team-creation requests the current user has submitted, including their statuses (pending, awaiting_user_confirmation, approved, rejected, cancelled).",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    const rows = await prisma.teamRequest.findMany({
      where: { requestedByUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      requests: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        roundCount: r.roundCount,
        rejectionReason: r.rejectionReason,
        createdTeamId: r.createdTeamId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  },
};

const myMaintainerRequests: RegisteredTool = {
  id: "requests_my_maintainer_requests",
  openaiDef: {
    type: "function",
    function: {
      name: "requests_my_maintainer_requests",
      description:
        "List all maintainer-promotion requests the current user has submitted, including statuses.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    const rows = await prisma.maintainerRequest.findMany({
      where: { requestedByUserId: userId },
      include: { team: { select: { slug: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      requests: rows.map((r) => ({
        id: r.id,
        teamSlug: r.team.slug,
        teamName: r.team.name,
        status: r.status,
        reason: r.reason,
        rejectionReason: r.rejectionReason,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  },
};

export const requestsGroup: ToolGroup = {
  meta: {
    id: "requests",
    label: "İstekler",
    description: "Kullanıcının açık istekleri ve durumları.",
    order: 30,
  },
  tools: [myPending, myTeamRequests, myMaintainerRequests],
};
