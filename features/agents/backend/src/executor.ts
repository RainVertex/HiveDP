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

// One LLM turn: the assistant's reasoning and text, plus the tools it invoked that turn.
export interface RunAgentStep {
  index: number;
  text: string | null;
  reasoning: string | null;
  toolCalls: RunAgentToolCall[];
  tokensInput: number;
  tokensOutput: number;
}

export interface RunAgentResult {
  agentRunId: string;
  status: "succeeded" | "failed" | "cancelled";
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

  // Register an abort handle keyed by run id so the cancel endpoint can stop this run no matter how
  // it was started (background kickoff, catalog job, or sync test run). Link any caller signal so a
  // job timeout or shutdown still aborts us.
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const runSignal = controller.signal;
  activeRuns.set(run.id, controller);

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
  const steps: RunAgentStep[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let finalText: string | null = null;
  // Coarse write signal: an "auto" agent is the platform's designated autonomous-write mode.
  let containsWrites = false;

  const model = agent.llmModel as ResolvedModel;

  const isAutonomousRun = (opts.callerUserId ?? null) == null;
  const blockToolsAutonomously = isAutonomousRun && agent.approvalMode === "ask";

  try {
    const toolCtx: ToolContext = {
      userId: opts.callerUserId ?? null,
      isAdmin: opts.callerIsAdmin ?? false,
      teamIds: opts.callerTeamIds ?? [],
      signal: runSignal,
    };

    for (let step = 0; step < agent.maxToolCalls; step++) {
      const result = await chatFn({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        signal: runSignal,
        temperature: agent.temperature,
      });
      tokensInput += result.usage.input;
      tokensOutput += result.usage.output;

      if (agent.tokenBudget != null && tokensInput + tokensOutput > agent.tokenBudget) {
        throw new Error("token_budget_exhausted");
      }

      const stepText =
        typeof result.message.content === "string" && result.message.content.length > 0
          ? result.message.content
          : null;
      if (stepText) {
        finalText = stepText;
      }

      const stepToolCalls: RunAgentToolCall[] = [];
      steps.push({
        index: step,
        text: stepText,
        reasoning: result.reasoning ?? null,
        toolCalls: stepToolCalls,
        tokensInput: result.usage.input,
        tokensOutput: result.usage.output,
      });

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
        const recorded: RunAgentToolCall = {
          name: tc.function.name,
          input: safeJsonParse(tc.function.arguments),
          output,
          durationMs: Date.now() - startedAt,
          isError,
        };
        toolCalls.push(recorded);
        stepToolCalls.push(recorded);
        if (!isError && agent.approvalMode === "auto") containsWrites = true;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(output),
        });
      }
    }

    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    // The loop can exit cleanly just as a cancel lands; honor the abort so a stopped run is not
    // recorded as succeeded.
    if (runSignal.aborted) {
      const error = abortMessage(opts.signal);
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "cancelled",
          error,
          output: { steps, toolCalls, finalText } as unknown as Prisma.InputJsonValue,
          tokensInput,
          tokensOutput,
          costUsd,
          containsWrites,
          finishedAt: new Date(),
        },
      });
      return {
        agentRunId: run.id,
        status: "cancelled",
        toolCalls,
        finalText,
        tokensInput,
        tokensOutput,
        costUsd,
        error,
      };
    }
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        output: { steps, toolCalls, finalText } as unknown as Prisma.InputJsonValue,
        tokensInput,
        tokensOutput,
        costUsd,
        containsWrites,
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
    const aborted = runSignal.aborted;
    const message = aborted
      ? abortMessage(opts.signal)
      : err instanceof Error
        ? err.message
        : String(err);
    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: aborted ? "cancelled" : "failed",
        error: message.slice(0, 2000),
        output: { steps, toolCalls, finalText } as unknown as Prisma.InputJsonValue,
        containsWrites,
        tokensInput,
        tokensOutput,
        costUsd,
        finishedAt: new Date(),
      },
    });
    return {
      agentRunId: run.id,
      status: aborted ? "cancelled" : "failed",
      toolCalls,
      finalText,
      tokensInput,
      tokensOutput,
      costUsd,
      error: message,
    };
  } finally {
    activeRuns.delete(run.id);
  }
}

// A run aborts either because a user hit Stop (our own controller) or because the caller's signal
// fired (a job timeout or process shutdown); name the cause for the recorded error.
function abortMessage(callerSignal: AbortSignal | undefined): string {
  return callerSignal?.aborted ? "Run aborted" : "Cancelled by user";
}

function safeJsonParse(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// In-memory handles for every in-flight run (runAgent registers itself), so a cancel request can
// abort it. Single-process only: a run started on another instance cannot be cancelled from here.
const activeRuns = new Map<string, AbortController>();

// Abort an in-flight run. Returns false if no run with that id is running on this instance.
export function cancelAgentRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

// On boot, any run still "running" is orphaned by a restart (nothing executes it). Mark such runs
// failed and release the catalog tasks they had claimed so those entities re-enter the queue.
export async function reconcileStaleAgentRuns(): Promise<{ runs: number; tasks: number }> {
  const runs = await prisma.agentRun.updateMany({
    where: { status: "running" },
    data: { status: "failed", error: "Orphaned by restart", finishedAt: new Date() },
  });
  const tasks = await prisma.catalogAgentTask.updateMany({
    where: { status: "running" },
    data: { status: "pending", startedAt: null },
  });
  return { runs: runs.count, tasks: tasks.count };
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
  // runAgent registers and clears the abort handle for run.id itself.
  void runAgent(agentId, input, { ...opts, existingRunId: run.id }).catch((err) => {
    console.error(`Background runAgent crashed for run ${run.id}:`, err);
  });
  return { runId: run.id };
}
