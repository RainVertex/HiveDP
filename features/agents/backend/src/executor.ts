import type OpenAI from "openai";
import { prisma, Prisma } from "@internal/db";
import {
  computeCostUsd,
  selectAdapter,
  providerKindFromProvider,
  resolveProviderApiKey,
  resolveTools,
  type ChatRequest,
  type ChatResult,
  type ResolvedModel,
  type ToolContext,
} from "@internal/llm-core";

// Generic agent execution. The agent row carries everything driving the loop:
// the system prompt (`instructions`), which tools it may call (`toolIds`), the
// model + provider (`modelId` -> LlmModel -> LlmProvider), the per-loop cap
// (`maxToolCalls`), the optional per-run token budget, and the approval mode.
// Every provider is talked to via the OpenAI shape so a single loop serves
// Ollama, OpenAI, and Anthropic without branching.

export type RunAgentInput = Record<string, unknown>;

export interface RunAgentToolCall {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  isError: boolean;
}

export interface RunAgentResult {
  agentRunId: string;
  status: "succeeded" | "failed";
  toolCalls: RunAgentToolCall[];
  finalText: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number | null;
  error: string | null;
}

export interface RunAgentOptions {
  // Override the chat function for tests. Defaults to the real adapter path.
  chat?: (req: ChatRequest) => Promise<ChatResult>;
  signal?: AbortSignal;
  // For runs initiated by an authenticated user. null for cron / system runs.
  // The id flows into ToolContext.userId so every tool scopes to this user
  // (per-user isolation). Autonomous runs (cron) pass null.
  callerUserId?: string | null;
  callerIsAdmin?: boolean;
  callerTeamIds?: string[];
  // When set, runAgent updates this existing AgentRun row instead of creating
  // a new one. The async-by-default route handler uses this so it can return
  // the runId to the client immediately while the executor runs in the
  // background.
  existingRunId?: string;
}

export async function runAgent(
  agentId: string,
  input: RunAgentInput,
  opts: RunAgentOptions = {},
): Promise<RunAgentResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { llmModel: { include: { provider: true } } },
  });
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const run = opts.existingRunId
    ? await prisma.agentRun.findUniqueOrThrow({ where: { id: opts.existingRunId } })
    : await prisma.agentRun.create({
        data: { agentId, status: "running", input: input as Prisma.InputJsonValue },
      });
  await prisma.agent.update({ where: { id: agentId }, data: { status: "running" } });

  // Provider key resolved once per run from the env var named on the provider
  // row. Local providers (Ollama) resolve to null. The adapter receives the
  // pre-resolved key via AdapterRequest.apiKey.
  const apiKey = await resolveProviderApiKey({
    providerSlug: agent.llmModel.provider.slug,
    apiKeyEnvVar: agent.llmModel.provider.apiKeyEnvVar,
  });

  // Adapter selected from the provider's kind. Tests inject opts.chat to skip
  // the network.
  const chatFn =
    opts.chat ??
    ((req: ChatRequest) =>
      selectAdapter(providerKindFromProvider(agent.llmModel.provider)).stream({
        ...req,
        apiKey,
      }) as Promise<ChatResult>);

  const toolIds = Array.isArray(agent.toolIds) ? (agent.toolIds as unknown as string[]) : [];
  const tools = resolveTools(toolIds);
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = tools.map(
    (t) => t.openaiDef,
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: agent.instructions },
    { role: "user", content: JSON.stringify(input) },
  ];

  const toolCalls: RunAgentToolCall[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let finalText: string | null = null;

  const model = agent.llmModel as ResolvedModel;

  // Lean approval: per-user isolation flows through ToolContext.userId. An
  // autonomous run (no invoking human) with approvalMode "ask" cannot confirm
  // any tool call, so tools are blocked; with "auto" they run (e.g. the
  // Catalog Enricher). Human-invoked runs always allow tools, the caller is
  // the human in the loop. Chat's interactive prepare/submit confirmation
  // lives in the chat streamExecutor, not here.
  const isAutonomousRun = (opts.callerUserId ?? null) == null;
  const blockToolsAutonomously = isAutonomousRun && agent.approvalMode === "ask";

  try {
    const toolCtx: ToolContext = {
      userId: opts.callerUserId ?? null,
      isAdmin: opts.callerIsAdmin ?? false,
      teamIds: opts.callerTeamIds ?? [],
      signal: opts.signal,
    };

    for (let step = 0; step < agent.maxToolCalls; step++) {
      const result = await chatFn({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        signal: opts.signal,
      });
      tokensInput += result.usage.input;
      tokensOutput += result.usage.output;

      if (agent.tokenBudget != null && tokensInput + tokensOutput > agent.tokenBudget) {
        throw new Error("token_budget_exhausted");
      }

      if (typeof result.message.content === "string" && result.message.content.length > 0) {
        finalText = result.message.content;
      }

      if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
        break;
      }

      // The assistant message goes back verbatim so the next turn includes
      // the model's tool_calls. tool_result messages then follow per call.
      messages.push(result.message as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      for (const tc of result.toolCalls) {
        const startedAt = Date.now();
        const toolDef = tools.find((t) => t.openaiDef.function.name === tc.function.name);
        let output: unknown;
        let isError = false;
        if (!toolDef) {
          output = { error: `Unknown tool: ${tc.function.name}` };
          isError = true;
        } else if (blockToolsAutonomously) {
          output = {
            error: `Agent runs in "ask" mode and has no human to confirm tool calls in an autonomous run.`,
            code: "approval_required",
          };
          isError = true;
        } else {
          try {
            const parsed = JSON.parse(tc.function.arguments || "{}");
            output = await toolDef.handler(parsed, toolCtx);
          } catch (err) {
            output = { error: (err as Error).message };
            isError = true;
          }
        }
        toolCalls.push({
          name: tc.function.name,
          input: safeJsonParse(tc.function.arguments),
          output,
          durationMs: Date.now() - startedAt,
          isError,
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(output),
        });
      }
    }

    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        output: { toolCalls, finalText } as unknown as Prisma.InputJsonValue,
        tokensInput,
        tokensOutput,
        costUsd,
        finishedAt: new Date(),
      },
    });
    await prisma.agent.update({ where: { id: agentId }, data: { status: "succeeded" } });
    return {
      agentRunId: run.id,
      status: "succeeded",
      toolCalls,
      finalText,
      tokensInput,
      tokensOutput,
      costUsd,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: message.slice(0, 2000),
        output: { toolCalls, finalText } as unknown as Prisma.InputJsonValue,
        tokensInput,
        tokensOutput,
        costUsd,
        finishedAt: new Date(),
      },
    });
    await prisma.agent.update({ where: { id: agentId }, data: { status: "failed" } });
    return {
      agentRunId: run.id,
      status: "failed",
      toolCalls,
      finalText,
      tokensInput,
      tokensOutput,
      costUsd,
      error: message,
    };
  }
}

function safeJsonParse(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// Async-by-default kickoff used by POST /api/agents/:id/run. Creates the
// AgentRun row synchronously so the route can return its id, then runs the
// executor in the background. runAgent's internal catch persists any failure
// into the row.
export async function startAgentRun(
  agentId: string,
  input: RunAgentInput,
  opts: RunAgentOptions = {},
): Promise<{ runId: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const run = await prisma.agentRun.create({
    data: { agentId, status: "running", input: input as Prisma.InputJsonValue },
  });
  void runAgent(agentId, input, { ...opts, existingRunId: run.id }).catch((err) => {
    console.error(`Background runAgent crashed for run ${run.id}:`, err);
  });
  return { runId: run.id };
}

// Catalog enricher compatibility wrapper.
//
// The daily cron at jobs.ts calls runEnricherForEntity. It adapts the generic
// result to the enricher's pre-existing shape (notably `driftsProposed`,
// derived from the tool-call list).

export interface EnricherInput {
  entityId: string;
}

export interface EnricherRunResult {
  agentRunId: string;
  status: "succeeded" | "failed";
  driftsProposed: number;
  toolCalls: RunAgentToolCall[];
  finalText: string | null;
  tokensInput: number;
  tokensOutput: number;
  error: string | null;
}

export interface RunEnricherOptions {
  chat?: (req: ChatRequest) => Promise<ChatResult>;
  signal?: AbortSignal;
}

export async function runEnricherForEntity(
  agentId: string,
  input: EnricherInput,
  opts: RunEnricherOptions = {},
): Promise<EnricherRunResult> {
  const result = await runAgent(agentId, input as unknown as RunAgentInput, opts);
  const driftsProposed = result.toolCalls.filter(
    (c) => c.name === "catalog_propose_drift" && !c.isError,
  ).length;
  return {
    agentRunId: result.agentRunId,
    status: result.status,
    driftsProposed,
    toolCalls: result.toolCalls,
    finalText: result.finalText,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    error: result.error,
  };
}

// Re-exports kept for callers that imported types from the old module shape.
export type { RunAgentToolCall as EnricherToolCall };
