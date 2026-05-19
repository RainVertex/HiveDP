import { prisma } from "@internal/db";
import type { UserRole } from "@internal/db";

// Build the effective request context for an agent action. Two scenarios:
//
//   onBehalfOfRequired = true (default for new agents):
//     Every action must come with an invoking human. The effective
//     permissions are the intersection of the agent's grants and the
//     invoker's grants — so an admin agent invoked by a member can only
//     do member-things. This is the "no privilege escalation" guarantee.
//
//   onBehalfOfRequired = false (admin opt-in for autonomous agents):
//     The agent runs on its own (cron, webhook). The agent's role/teams
//     govern. There is no invoker to intersect against.
//
// `effectiveRole = min(agent.role, invoker.role)` where the role lattice
// is admin > member. Team intersection is set-intersection on the
// teamIds each side belongs to.

export interface AgentRequestContext {
  agentUserId: string;
  invokerUserId: string | null;
  /** The role used for permission decisions for this action. */
  effectiveRole: UserRole;
  /** The teams used for permission decisions for this action. */
  effectiveTeamIds: string[];
}

const ROLE_LEVEL: Record<UserRole, number> = { admin: 2, member: 1 };

function minRole(a: UserRole, b: UserRole): UserRole {
  return ROLE_LEVEL[a] <= ROLE_LEVEL[b] ? a : b;
}

export async function buildAgentRequestContext(args: {
  agentUserId: string;
  invokerUserId: string | null;
}): Promise<AgentRequestContext> {
  const agent = await prisma.user.findUnique({
    where: { id: args.agentUserId },
    select: {
      id: true,
      role: true,
      userKind: true,
      memberships: { select: { teamId: true } },
      agentProfile: { select: { onBehalfOfRequired: true } },
    },
  });
  if (!agent) {
    throw new Error(`Agent user ${args.agentUserId} not found`);
  }
  if (agent.userKind !== "agent") {
    throw new Error(`User ${args.agentUserId} is not an agent (userKind=${agent.userKind})`);
  }

  const onBehalfRequired = agent.agentProfile?.onBehalfOfRequired ?? true;

  if (onBehalfRequired && !args.invokerUserId) {
    throw new Error(
      `Agent ${args.agentUserId} has onBehalfOfRequired=true and cannot run without an invoking user`,
    );
  }

  if (!args.invokerUserId) {
    // Fully autonomous run: agent's own role/teams govern.
    return {
      agentUserId: agent.id,
      invokerUserId: null,
      effectiveRole: agent.role,
      effectiveTeamIds: agent.memberships.map((m) => m.teamId),
    };
  }

  const invoker = await prisma.user.findUnique({
    where: { id: args.invokerUserId },
    select: {
      id: true,
      role: true,
      memberships: { select: { teamId: true } },
    },
  });
  if (!invoker) {
    throw new Error(`Invoker user ${args.invokerUserId} not found`);
  }

  const agentTeamIds = new Set(agent.memberships.map((m) => m.teamId));
  const effectiveTeamIds = invoker.memberships
    .map((m) => m.teamId)
    .filter((id) => agentTeamIds.has(id));

  return {
    agentUserId: agent.id,
    invokerUserId: invoker.id,
    effectiveRole: minRole(agent.role, invoker.role),
    effectiveTeamIds,
  };
}
