import { prisma, Prisma } from "@internal/db";

export type AgentRunDetail = Prisma.AgentRunGetPayload<{
  include: {
    agent: { select: { name: true; avatarUrl: true } };
    user: { select: { userKind: true } };
  };
}>;

export interface AgentRunRepository {
  findById(runId: string): Promise<AgentRunDetail | null>;
  requestCancel(runId: string): Promise<void>;
}

export const runRepository: AgentRunRepository = {
  findById(runId) {
    return prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        agent: { select: { name: true, avatarUrl: true } },
        user: { select: { userKind: true } },
      },
    });
  },
  // The run executes in a worker process; flag the row so that process's poll aborts it there.
  async requestCancel(runId) {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { cancelRequestedAt: new Date() },
    });
  },
};
