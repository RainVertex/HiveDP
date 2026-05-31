// Scheduled agent jobs: the daily catalog enrichment sweep with a soft token cap.
import { prisma } from "@internal/db";
import { runEnricherForEntity } from "./executor";

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

export function catalogEnricherJob(): AgentJobDefinition {
  return {
    name: "agents.catalogEnricher",
    schedule: "45 3 * * *",
    timeoutMs: 30 * 60 * 1000,
    handler: async ({ log, signal }) => {
      const agent = await prisma.agent.findUnique({
        where: { id: ENRICHER_AGENT_ID },
        include: { llmModel: { include: { provider: true } } },
      });
      if (!agent) {
        log.info({}, "Skipping enricher: agent row not seeded");
        return;
      }
      const envVar = agent.llmModel.provider.apiKeyEnvVar;
      if (envVar && !process.env[envVar]) {
        log.info({ envVar }, `Skipping enricher: ${envVar} not set`);
        return;
      }

      const entities = await prisma.catalogEntity.findMany({
        where: { repoUrl: { not: null } },
        select: { id: true, name: true },
        orderBy: { lastSeenAt: "asc" },
        take: 50,
      });

      const dailyTokenCap = Number(process.env.CATALOG_ENRICHER_DAILY_TOKEN_CAP ?? 500_000);
      let tokensSpent = 0;
      let processed = 0;
      let driftsProposed = 0;
      let failed = 0;

      for (const entity of entities) {
        if (signal.aborted) break;
        if (tokensSpent >= dailyTokenCap) {
          log.info({ tokensSpent, dailyTokenCap }, "Token cap reached; halting enrichment sweep");
          break;
        }
        try {
          const result = await runEnricherForEntity(
            ENRICHER_AGENT_ID,
            { entityId: entity.id },
            { signal },
          );
          processed++;
          tokensSpent += result.tokensInput + result.tokensOutput;
          driftsProposed += result.driftsProposed;
          if (result.status === "failed") failed++;
        } catch (err) {
          failed++;
          log.info({ entityId: entity.id, error: (err as Error).message }, "Enricher run failed");
        }
      }

      log.info(
        { processed, driftsProposed, failed, tokensSpent },
        "Catalog enrichment sweep complete",
      );
    },
  };
}

export function getAgentJobs(): AgentJobDefinition[] {
  return [catalogEnricherJob()];
}
