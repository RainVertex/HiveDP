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
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: { userId: true },
  });
  // Fairness bucket: the agent's owner, or a per-agent bucket for ownerless (autonomous) agents so no
  // single autonomous agent can starve the others.
  const ownerKey = agent?.userId ?? `agent:${input.agentId}`;
  return prisma.agentTask.create({
    data: {
      agentId: input.agentId,
      kind: input.kind,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      scheduledAt: input.scheduledAt,
      maxAttempts: input.maxAttempts,
      dedupeKey: input.dedupeKey ?? null,
      ownerKey,
    },
  });
}

// Atomically claims a single due task, fairly. Owners (ownerKey) already running `userCap` tasks are
// skipped so no user can monopolize the pool; among the rest the oldest due task wins. The per-row
// atomic guard makes concurrent claimers (multiple slots and multiple worker instances) safe against
// double-running. Returns null when nothing is claimable right now.
export async function claimOneFair(opts: {
  runtimes?: string[];
  userCap: number;
}): Promise<AgentTask | null> {
  const { runtimes, userCap } = opts;
  const runtimeFilter = runtimes ? { agent: { runtime: { in: runtimes } } } : {};

  const running = await prisma.agentTask.groupBy({
    by: ["ownerKey"],
    where: { status: "running", ...runtimeFilter },
    _count: { _all: true },
  });
  const capped = running
    .filter((r) => r.ownerKey != null && r._count._all >= userCap)
    .map((r) => r.ownerKey as string);

  const candidates = await prisma.agentTask.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: new Date() },
      ...(capped.length ? { ownerKey: { notIn: capped } } : {}),
      ...runtimeFilter,
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    select: { id: true, attempts: true, maxAttempts: true },
  });

  for (const c of candidates) {
    // Defensive: a pending row past its attempt budget should have been dead-lettered already; if one
    // slips through, terminate it here rather than claim it.
    if (c.attempts >= c.maxAttempts) {
      await prisma.agentTask.updateMany({
        where: { id: c.id, status: "pending" },
        data: { status: "failed", finishedAt: new Date(), lastError: "max attempts exceeded" },
      });
      continue;
    }
    const res = await prisma.agentTask.updateMany({
      where: { id: c.id, status: "pending" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (res.count === 1) return prisma.agentTask.findUniqueOrThrow({ where: { id: c.id } });
  }
  return null;
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

export interface ReconcileTasksResult {
  released: number;
  deadLettered: number;
}

// A task still "running" on boot was orphaned by a restart, often because it crashed the worker. Each
// claim already incremented attempts, so a task that has burned its whole budget this way is a poison
// task: dead-letter it (terminal "failed") instead of releasing it to crash the next worker. The rest
// go back to "pending" for a normal retry. Without this attempt check the queue could loop forever.
async function reconcileStaleTasks(runtimes?: string[]): Promise<ReconcileTasksResult> {
  const runtimeFilter = runtimes ? { agent: { runtime: { in: runtimes } } } : {};
  const stuck = await prisma.agentTask.findMany({
    where: { status: "running", ...runtimeFilter },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  const dead = stuck.filter((t) => t.attempts >= t.maxAttempts).map((t) => t.id);
  const retry = stuck.filter((t) => t.attempts < t.maxAttempts).map((t) => t.id);
  if (dead.length) {
    await prisma.agentTask.updateMany({
      where: { id: { in: dead } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: "Worker died mid-run and max attempts reached (poison task)",
      },
    });
  }
  if (retry.length) {
    await prisma.agentTask.updateMany({
      where: { id: { in: retry } },
      data: { status: "pending", startedAt: null },
    });
  }
  return { released: retry.length, deadLettered: dead.length };
}

// The chat worker releases only chat tasks on boot, the coding worker only coding tasks, so neither
// touches a task the other process is actively executing.
export function reconcileStaleChatTasks(): Promise<ReconcileTasksResult> {
  return reconcileStaleTasks(["chat"]);
}

export function reconcileStaleCodingTasks(): Promise<ReconcileTasksResult> {
  return reconcileStaleTasks(["code"]);
}
