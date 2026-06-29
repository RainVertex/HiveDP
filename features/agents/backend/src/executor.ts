import type OpenAI from "openai";
import { prisma, Prisma } from "@internal/db";
import {
  selectAdapter,
  providerKindFromProvider,
  resolveProviderApiKey,
  openAgentMcpToolset,
  mcpOAuthRedirectUrl,
  type ChatRequest,
  type ChatResult,
  type ResolvedModel,
  type ToolContext,
  type McpToolset,
} from "@internal/llm-core";
import { resolveAgentSkills, appendSkillGuidance } from "./services/skills";
import { finalizeAgentRun } from "./runFinalize";
import { runCodingAgent } from "./coding/runCodingAgent";
import type {
  RunAgentInput,
  RunAgentOptions,
  RunAgentResult,
  RunAgentStep,
  RunAgentToolCall,
} from "./runTypes";

// Generic agent execution loop (runAgent) plus the async kickoff and catalog-enricher wrapper.

export type {
  RunAgentInput,
  RunAgentOptions,
  RunAgentResult,
  RunAgentStep,
  RunAgentToolCall,
} from "./runTypes";

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

  // Hard wall-clock ceiling: a hung LLM socket or runaway tool loop must not pin a worker slot forever.
  // Coding has its own in-container docker-kill timeout, so its ceiling sits just above that as a backstop.
  let timedOut = false;
  const runTimeoutMs =
    opts.timeoutMs ??
    (agent.runtime === "code"
      ? Number(process.env.CODING_RUNNER_TIMEOUT_MS ?? 1_200_000) + 60_000
      : Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 600_000));
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Run exceeded time limit"));
  }, runTimeoutMs);

  // Cross-process cancel: the run may execute in a worker while Stop is issued from the API, so the API
  // sets cancelRequestedAt on the row and this poll turns it into a local abort.
  const cancelPollMs = Number(process.env.AGENT_CANCEL_POLL_MS ?? 3000);
  const cancelPoller = setInterval(() => {
    void prisma.agentRun
      .findUnique({ where: { id: run.id }, select: { cancelRequestedAt: true } })
      .then((fresh) => {
        if (fresh?.cancelRequestedAt) controller.abort();
      })
      .catch(() => {});
  }, cancelPollMs);

  const clearRunTimers = (): void => {
    clearTimeout(timeoutTimer);
    clearInterval(cancelPoller);
  };

  // Coding agents run Aider over a cloned worktree in a sandbox instead of the chat tool loop. The run
  // row and abort handle are already in place, so a coding run is cancellable and finalized exactly
  // like a chat run, only the middle differs.
  if (agent.runtime === "code") {
    try {
      return await runCodingAgent({ agent, input, opts, run, runSignal });
    } finally {
      clearRunTimers();
      activeRuns.delete(run.id);
    }
  }

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

  const skillIds = Array.isArray(agent.skillIds) ? (agent.skillIds as unknown as string[]) : [];
  const { tools: baseTools, guidance } = await resolveAgentSkills(skillIds);

  // Merge tools from the agent's attached external MCP servers. Autonomous runs (no caller user)
  // skip OAuth servers, an unreachable server is skipped with a warning, so the loop runs with
  // whatever tools resolve.
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3010";
  const mcpToolset: McpToolset | null = await openAgentMcpToolset(
    agentId,
    opts.callerUserId ?? null,
    { redirectUrl: mcpOAuthRedirectUrl(webOrigin), redirectTo: webOrigin },
  );
  const tools = mcpToolset ? [...baseTools, ...mcpToolset.tools] : baseTools;
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = tools.map(
    (t) => t.openaiDef,
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: appendSkillGuidance(agent.instructions, guidance) },
    { role: "user", content: JSON.stringify(input) },
  ];

  const toolCalls: RunAgentToolCall[] = [];
  const steps: RunAgentStep[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let tokensCacheWrite = 0;
  let finalText: string | null = null;

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
      tokensCacheRead += result.usage.cacheRead;
      tokensCacheWrite += result.usage.cacheWrite;

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
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(output),
        });
      }
    }

    const output = { steps, toolCalls, finalText } as unknown as Prisma.InputJsonValue;
    // The loop can exit cleanly just as a cancel or timeout lands; honor the abort so a stopped run is
    // not recorded as succeeded. A timeout is a failure, a user/shutdown abort is a cancellation.
    const aborted = runSignal.aborted;
    return finalizeAgentRun({
      runId: run.id,
      model,
      status: aborted ? (timedOut ? "failed" : "cancelled") : "succeeded",
      tokensInput,
      tokensOutput,
      cacheRead: tokensCacheRead,
      cacheWrite: tokensCacheWrite,
      output,
      finalText,
      toolCalls,
      error: aborted ? (timedOut ? "Run exceeded time limit" : abortMessage(opts.signal)) : null,
    });
  } catch (err) {
    const aborted = runSignal.aborted;
    const message = timedOut
      ? "Run exceeded time limit"
      : aborted
        ? abortMessage(opts.signal)
        : err instanceof Error
          ? err.message
          : String(err);
    return finalizeAgentRun({
      runId: run.id,
      model,
      status: aborted && !timedOut ? "cancelled" : "failed",
      tokensInput,
      tokensOutput,
      cacheRead: tokensCacheRead,
      cacheWrite: tokensCacheWrite,
      output: { steps, toolCalls, finalText } as unknown as Prisma.InputJsonValue,
      finalText,
      toolCalls,
      error: message,
    });
  } finally {
    clearRunTimers();
    activeRuns.delete(run.id);
    if (mcpToolset) await mcpToolset.close();
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

// On boot a run still "running" was orphaned by a restart (nothing executes it). Each worker reconciles
// only its own runtime so it never touches a run another process is actively executing. Orphaned
// AgentTask rows are released separately by the reconcileStale*Tasks helpers.
async function reconcileStaleRuns(runtime: string): Promise<{ runs: number }> {
  const runs = await prisma.agentRun.updateMany({
    where: { status: "running", agent: { runtime } },
    data: { status: "failed", error: "Orphaned by worker restart", finishedAt: new Date() },
  });
  return { runs: runs.count };
}

export function reconcileStaleChatRuns(): Promise<{ runs: number }> {
  return reconcileStaleRuns("chat");
}

export function reconcileStaleCodingRuns(): Promise<{ runs: number }> {
  return reconcileStaleRuns("code");
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
