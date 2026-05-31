import { prisma } from "./index";

// Every Agent acts through a backing User (userKind='agent') so it can be assigned to tasks and granted team/project access like a teammate. Synthetic identity fields are derived from the agent id so they stay unique and stable.

export interface AgentIdentity {
  name: string;
  avatarUrl?: string | null;
}

export async function ensureAgentBackingUser(
  agentId: string,
  identity: AgentIdentity,
): Promise<string> {
  const githubId = `agent:${agentId}`;
  const githubLogin = `agent-${agentId}`;
  const email = `${agentId}@agents.local`;
  const user = await prisma.user.upsert({
    where: { githubId },
    update: { displayName: identity.name, avatarUrl: identity.avatarUrl ?? null },
    create: {
      githubId,
      githubLogin,
      email,
      displayName: identity.name,
      avatarUrl: identity.avatarUrl ?? null,
      userKind: "agent",
      role: "member",
      status: "active",
    },
    select: { id: true },
  });
  await prisma.agent.update({ where: { id: agentId }, data: { userId: user.id } });
  return user.id;
}
