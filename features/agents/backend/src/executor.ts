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

// Generic agent execution loop (runAgent) plus the async kickoff and catalog-enricher wrapper.

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
  chat?: (req: ChatRequest) => Promise<ChatResult>;
  signal?: AbortSignal;
  callerUserId?: string | null;
  callerIsAdmin?: boolean;
  callerTeamIds?: string[];
  existingRunId?: string;
  // Provenance recorded on the AgentRun so a bot's history is queryable and contextual.
  trigger?: string;
  taskId?: string | null;
  conversationId?: string | null;
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
        data: {
          agentId,
          userId: opts.callerUserId ?? null,
          trigger: opts.trigger ?? null,
          taskId: opts.taskId ?? null,
          conversationId: opts.conversationId ?? null,
          status: "running",
          input: input as Prisma.InputJsonValue,
        },
      });

  const apiKey = await resolveProviderApiKey({
    providerId: agent.llmModel.provider.id,
    providerSlug: agent.llmModel.provider.slug,
    apiKeyEnvVar: agent.llmModel.provider.apiKeyEnvVar,
    isAdmin: opts.callerIsAdmin ?? false,
  });

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
        temperature: agent.temperature,
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

export async function startAgentRun(
  agentId: string,
  input: RunAgentInput,
  opts: RunAgentOptions = {},
): Promise<{ runId: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const run = await prisma.agentRun.create({
    data: {
      agentId,
      userId: opts.callerUserId ?? null,
      trigger: opts.trigger ?? null,
      taskId: opts.taskId ?? null,
      conversationId: opts.conversationId ?? null,
      status: "running",
      input: input as Prisma.InputJsonValue,
    },
  });
  void runAgent(agentId, input, { ...opts, existingRunId: run.id }).catch((err) => {
    console.error(`Background runAgent crashed for run ${run.id}:`, err);
  });
  return { runId: run.id };
}

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
  const result = await runAgent(agentId, input as unknown as RunAgentInput, {
    ...opts,
    trigger: "cron",
  });
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

export type { RunAgentToolCall as EnricherToolCall };
