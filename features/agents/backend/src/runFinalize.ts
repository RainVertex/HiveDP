import { prisma, Prisma } from "@internal/db";
import { computeCostUsd, type ResolvedModel } from "@internal/llm-core";
import type { RunAgentResult, RunAgentToolCall } from "./runTypes";

// Single place both runtimes (chat loop and coding) settle an AgentRun: compute cost from usage,
// persist the terminal row, and return the RunAgentResult the queue interprets. The stored `error`
// is truncated; the returned one is full so callers see the whole message.

export interface FinalizeAgentRunInput {
  runId: string;
  model: ResolvedModel;
  status: "succeeded" | "failed" | "cancelled";
  tokensInput: number;
  tokensOutput: number;
  cacheRead?: number;
  cacheWrite?: number;
  output: Prisma.InputJsonValue;
  finalText: string | null;
  toolCalls: RunAgentToolCall[];
  error: string | null;
  containsWrites?: boolean;
}

export async function finalizeAgentRun(input: FinalizeAgentRunInput): Promise<RunAgentResult> {
  const costUsd = computeCostUsd(input.model, {
    input: input.tokensInput,
    output: input.tokensOutput,
    cacheRead: input.cacheRead ?? 0,
    cacheWrite: input.cacheWrite ?? 0,
  });
  await prisma.agentRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      error: input.error ? input.error.slice(0, 2000) : null,
      output: input.output,
      tokensInput: input.tokensInput,
      tokensOutput: input.tokensOutput,
      costUsd,
      containsWrites: input.containsWrites ?? false,
      finishedAt: new Date(),
    },
  });
  return {
    agentRunId: input.runId,
    status: input.status,
    toolCalls: input.toolCalls,
    finalText: input.finalText,
    tokensInput: input.tokensInput,
    tokensOutput: input.tokensOutput,
    costUsd,
    error: input.error,
  };
}
