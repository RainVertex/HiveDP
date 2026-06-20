import { prisma, Prisma, type AgentTask } from "@internal/db";

// Generic durable agent work queue. Mechanics only (atomic claim, attempts,
// exponential backoff), the per-kind meaning of a task lives in agentTaskHandlers.

export interface EnqueueAgentTaskInput {
  agentId: string;
  kind: string;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
  maxAttempts?: number;
  // When set, re-enqueues collapse onto the existing open (pending or running) task.
  dedupeKey?: string | null;
}

export async function enqueueAgentTask(input: EnqueueAgentTaskInput): Promise<AgentTask> {
  if (input.dedupeKey) {
    const open = await prisma.agentTask.findFirst({
      where: { dedupeKey: input.dedupeKey, status: { in: ["pending", "running"] } },
    });
    if (open) return open;
  }
  return prisma.agentTask.create({
    data: {
      agentId: input.agentId,
      kind: input.kind,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      scheduledAt: input.scheduledAt,
      maxAttempts: input.maxAttempts,
      dedupeKey: input.dedupeKey ?? null,
    },
  });
}

// Claims up to `limit` due tasks. Claim is atomic per row so a concurrent worker cannot double-run.
export async function claimDueTasks(limit: number): Promise<AgentTask[]> {
  const due = await prisma.agentTask.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const claimed: AgentTask[] = [];
  for (const { id } of due) {
    const res = await prisma.agentTask.updateMany({
      where: { id, status: "pending" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (res.count === 1) claimed.push(await prisma.agentTask.findUniqueOrThrow({ where: { id } }));
  }
  return claimed;
}

export async function settleTask(
  id: string,
  data: {
    status: "done" | "skipped";
    runId?: string | null;
    lastError?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.agentTask.update({
    where: { id },
    data: {
      status: data.status,
      finishedAt: new Date(),
      lastError: data.lastError ?? null,
      runId: data.runId ?? undefined,
      payload: data.payload ? (data.payload as Prisma.InputJsonValue) : undefined,
    },
  });
}

// Either re-queues with exponential backoff or, past the cap, marks the task terminally failed.
export async function failTask(
  id: string,
  attempts: number,
  maxAttempts: number,
  error: string,
  runId?: string | null,
): Promise<void> {
  if (attempts >= maxAttempts) {
    await prisma.agentTask.update({
      where: { id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: error.slice(0, 2000),
        runId: runId ?? undefined,
      },
    });
    return;
  }
  const backoffMs = Math.min(2 ** attempts, 16) * 60_000;
  await prisma.agentTask.update({
    where: { id },
    data: {
      status: "pending",
      scheduledAt: new Date(Date.now() + backoffMs),
      lastError: error.slice(0, 2000),
      runId: runId ?? undefined,
    },
  });
}

// Re-queues a claimed task without counting the claim as an attempt (used when a precheck defers it).
export async function deferTask(
  id: string,
  attempts: number,
  delayMs: number,
  reason?: string,
): Promise<void> {
  await prisma.agentTask.update({
    where: { id },
    data: {
      status: "pending",
      attempts: Math.max(0, attempts - 1),
      startedAt: null,
      scheduledAt: new Date(Date.now() + delayMs),
      lastError: reason ?? null,
    },
  });
}

// On boot a task still "running" was orphaned by a restart, so release it back to the queue.
export async function reconcileStaleAgentTasks(): Promise<number> {
  const res = await prisma.agentTask.updateMany({
    where: { status: "running" },
    data: { status: "pending", startedAt: null },
  });
  return res.count;
}
