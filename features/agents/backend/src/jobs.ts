// Scheduled agent jobs: the catalog enricher workers that drain the CatalogAgentTask queue.
import { prisma, Prisma } from "@internal/db";
import { providerHasStoredKey } from "@internal/llm-core";
import { runAgent } from "./executor";

export interface AgentJobLogger {
  info(o: unknown, msg?: string): void;
  error?(o: unknown, msg?: string): void;
}

export interface AgentJobContext {
  log: AgentJobLogger;
  signal: AbortSignal;
}

export interface AgentJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: AgentJobContext) => Promise<void>;
}

const ENRICHER_AGENT_ID = "seed-agent-catalog-enricher";
const MAX_ATTEMPTS = 3;
// Terminal tool-error codes: retrying won't help (the entity simply can't be filled via a repo PR).
const SKIP_CODES = new Set(["no_repo", "no_installation", "not_github", "not_found"]);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Drains up to maxTasks pending CatalogAgentTask rows: each runs the enricher on its entity to open a catalog-info.yaml PR.
async function drainCatalogTasks(ctx: AgentJobContext, maxTasks: number): Promise<void> {
  const { log, signal } = ctx;
  const agent = await prisma.agent.findUnique({
    where: { id: ENRICHER_AGENT_ID },
    include: { llmModel: { include: { provider: true } } },
  });
  if (!agent) {
    log.info({}, "Skipping enricher: agent row not seeded");
    return;
  }
  const provider = agent.llmModel.provider;
  if (provider.apiKeyEnvVar && !(await providerHasStoredKey(provider.id))) {
    log.info({ provider: provider.slug }, "Skipping enricher: provider has no API key configured");
    return;
  }

  const dailyTokenCap = Number(process.env.CATALOG_ENRICHER_DAILY_TOKEN_CAP ?? 500_000);
  let tokensSpent = 0;
  let processed = 0;
  let prsOpened = 0;
  let failed = 0;
  let skipped = 0;

  const pending = await prisma.catalogAgentTask.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: maxTasks,
    select: { id: true, entityId: true, attempts: true, payload: true },
  });

  for (const task of pending) {
    if (signal.aborted) break;
    if (tokensSpent >= dailyTokenCap) {
      log.info({ tokensSpent, dailyTokenCap }, "Token cap reached; halting enrichment sweep");
      break;
    }

    // Claim atomically so a concurrent worker can't double-run the same task.
    const claim = await prisma.catalogAgentTask.updateMany({
      where: { id: task.id, status: "pending" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;
    const attempts = task.attempts + 1;
    const basePayload = asRecord(task.payload);

    try {
      const result = await runAgent(
        ENRICHER_AGENT_ID,
        { entityId: task.entityId },
        { signal, trigger: "catalog-task" },
      );
      tokensSpent += result.tokensInput + result.tokensOutput;
      processed++;

      const prCall = result.toolCalls.find((c) => c.name === "catalog_open_yaml_pr");
      const prOut = prCall ? asRecord(prCall.output) : null;
      const prUrl = prOut && typeof prOut.prUrl === "string" ? prOut.prUrl : null;
      const errCode = prOut && typeof prOut.code === "string" ? prOut.code : null;

      if (prUrl) {
        prsOpened++;
        await prisma.catalogAgentTask.update({
          where: { id: task.id },
          data: {
            status: "done",
            finishedAt: new Date(),
            lastError: null,
            payload: {
              ...basePayload,
              prUrl,
              branchName: typeof prOut?.branchName === "string" ? prOut.branchName : null,
              agentRunId: result.agentRunId,
            } as Prisma.InputJsonValue,
          },
        });
      } else if (errCode && SKIP_CODES.has(errCode)) {
        skipped++;
        await prisma.catalogAgentTask.update({
          where: { id: task.id },
          data: {
            status: "skipped",
            finishedAt: new Date(),
            lastError: String(prOut?.error ?? errCode),
          },
        });
      } else if (result.status === "succeeded" && !prCall) {
        // The agent judged the catalog-info.yaml already complete and opened no PR.
        await prisma.catalogAgentTask.update({
          where: { id: task.id },
          data: { status: "done", finishedAt: new Date(), lastError: null },
        });
      } else if (result.status === "cancelled") {
        // Stopped by a user or shutdown: leave it terminal rather than re-queueing a run they killed.
        skipped++;
        await prisma.catalogAgentTask.update({
          where: { id: task.id },
          data: { status: "skipped", finishedAt: new Date(), lastError: "Cancelled" },
        });
      } else {
        failed++;
        await failTask(task.id, attempts, result.error ?? String(prOut?.error ?? "no PR opened"));
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.info({ taskId: task.id, error: message }, "Enricher task run threw");
      await failTask(task.id, attempts, message);
    }
  }

  log.info(
    { processed, prsOpened, failed, skipped, tokensSpent },
    "Catalog enrichment sweep complete",
  );
}

// Daily bulk sweep, bounded by the token cap.
export function catalogEnricherJob(): AgentJobDefinition {
  return {
    name: "agents.catalogEnricher",
    schedule: "45 3 * * *",
    timeoutMs: 30 * 60 * 1000,
    handler: (ctx) => drainCatalogTasks(ctx, 50),
  };
}

// Near-real-time drain so a freshly connected org (or a push that unowns an entity) gets enriched within minutes, not at the daily sweep.
export function catalogEnricherDrainJob(): AgentJobDefinition {
  return {
    name: "agents.catalogEnricherDrain",
    schedule: "*/10 * * * *",
    timeoutMs: 5 * 60 * 1000,
    handler: (ctx) => drainCatalogTasks(ctx, 5),
  };
}

// Give up after MAX_ATTEMPTS; otherwise re-queue with exponential backoff so transient errors retry later.
async function failTask(taskId: string, attempts: number, error: string): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await prisma.catalogAgentTask.update({
      where: { id: taskId },
      data: { status: "failed", finishedAt: new Date(), lastError: error.slice(0, 2000) },
    });
    return;
  }
  const backoffMs = Math.min(2 ** attempts, 16) * 60_000;
  await prisma.catalogAgentTask.update({
    where: { id: taskId },
    data: {
      status: "pending",
      scheduledAt: new Date(Date.now() + backoffMs),
      lastError: error.slice(0, 2000),
    },
  });
}

export function getAgentJobs(): AgentJobDefinition[] {
  return [catalogEnricherJob(), catalogEnricherDrainJob()];
}
