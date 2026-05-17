import OpenAI from "openai";
import { prisma, Prisma } from "@internal/db";
import {
  computeCostUsd,
  decidePolicy,
  resolveProviderApiKey,
  resolveTools,
  selectAdapter,
  type AdapterRequest,
  type ResolvedModel,
  type RegisteredTool,
  type ToolContext,
} from "@feature/agents-backend";
import type { ChatSseEvent, ChatToolCallSummary, ChatPolicyCheck } from "@internal/shared-types";
import { platformAssistantToolIds } from "./tools";
import { ThinkTagSplitter } from "./thinkTagSplitter";

const PLATFORM_ASSISTANT_AGENT_ID = "seed-agent-assistant";

// SSE-emitting sibling of runAgent. Same multi-turn tool loop, but:
//
// - Calls the OpenAI SDK with `stream: true` and forwards token deltas via
//   onEvent("token") so the UI can show typing.
// - Routes tool calls per the concurrency policy: reads run in parallel,
//   *_prepare calls are serial per toolId in a turn, *_submit calls are
//   always serial in a turn (extras are deferred to the next loop iteration).
// - Persists conversation history to ChatMessage and audit/cost telemetry
//   to AgentRun, mirroring runAgent's audit shape.
// - Tracks `containsWrites` so admins can filter chat-driven writes in
//   observability.
//
// The route handler wires onEvent to actual SSE frames; tests can pass any
// callback. AbortSignal cooperates via ToolContext.signal — the loop checks
// signal.aborted between turns and tools cooperate inside their handlers.

const MAX_HISTORY_PAIRS = 20;

export interface StreamAgentArgs {
  agentId: string;
  conversationId: string;
  userMessageContent: string;
  callerUserId: string;
  callerIsAdmin: boolean;
  callerTeamIds: string[];
  signal?: AbortSignal;
  onEvent: (e: ChatSseEvent) => void;
}

export interface StreamAgentResult {
  agentRunId: string;
  containsWrites: boolean;
  finalText: string;
  /** Concatenated reasoning text from all `<think>` blocks across the turn. */
  reasoning: string | null;
  /** Total ms spent inside `<think>` blocks during the turn. */
  reasoningDurationMs: number | null;
}

/** Server-emitted preview side-channel from a *_prepare tool's handler back up to */
export interface PrepareReturnEnvelope {
  __previewEvent: {
    shortHandle: string;
    toolId: string;
    serverSummary: string;
    parsedParams: Record<string, unknown>;
    sideEffects: string[];
    policyChecks: ChatPolicyCheck[];
  };
  /** What the LLM sees — short handle + summary + checks only. */
  forLlm: {
    handle: string;
    serverSummary: string;
    policyChecks: ChatPolicyCheck[];
  };
}

export function isPrepareEnvelope(v: unknown): v is PrepareReturnEnvelope {
  return (
    !!v &&
    typeof v === "object" &&
    "__previewEvent" in v &&
    "forLlm" in v &&
    typeof (v as PrepareReturnEnvelope).forLlm === "object"
  );
}

export async function streamAgent(args: StreamAgentArgs): Promise<StreamAgentResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: args.agentId },
    include: { llmModel: { include: { provider: true } } },
  });
  if (!agent) throw new Error(`Agent not found: ${args.agentId}`);

  // Allocate the AgentRun row up front so failures are recorded.
  const run = await prisma.agentRun.create({
    data: {
      agentId: args.agentId,
      status: "running",
      input: {
        conversationId: args.conversationId,
        userMessage: args.userMessageContent,
      } as Prisma.InputJsonValue,
    },
  });

  const toolCtx: ToolContext = {
    userId: args.callerUserId,
    isAdmin: args.callerIsAdmin,
    teamIds: args.callerTeamIds,
    signal: args.signal,
  };
  // Carry conversationId + the AgentRun id on the context so chat-aware tools
  // (write actions especially) can scope to the conversation and stamp the
  // audit row with the agentRunId. Stashed on the same object so we don't
  // break ToolContext's public shape.
  const chatCtx = toolCtx as ToolContext & {
    conversationId?: string;
    agentRunId?: string;
  };
  chatCtx.conversationId = args.conversationId;
  chatCtx.agentRunId = run.id;

  // For the seeded Platform Assistant, prefer the canonical computed list
  // over agent.toolIds in DB so newly-added chat tools (e.g.
  // integrations_list_github) are picked up without requiring a re-seed.
  // Other agents continue to use whatever was persisted on the row.
  const persistedIds = Array.isArray(agent.toolIds) ? (agent.toolIds as unknown as string[]) : [];
  const toolIds =
    args.agentId === PLATFORM_ASSISTANT_AGENT_ID ? platformAssistantToolIds() : persistedIds;
  const tools = resolveTools(toolIds);
  const openaiTools = tools.map((t) => t.openaiDef);

  // Build the message history from prior ChatMessage rows. Truncation rules:
  // keep the last MAX_HISTORY_PAIRS user/assistant pairs verbatim, including
  // each assistant's tool_calls + tool results so the model has the context
  // it emitted previously.
  const history = await loadHistory(args.conversationId);

  // The history loader currently strips tool calls (see its comment), so the
  // model loses the prv_NN handle from any prior *_prepare tool call across
  // turns. Without this, when the user confirms in the next turn ("yes",
  // "proceed"), the model has nothing to pass to *_submit and re-prepares
  // instead — superseding the original preview and never actually submitting.
  // Re-inject any pending previews for this conversation as a system note so
  // the model knows which handles are available. Also build a per-prepare
  // toolId map for the dispatch-time guardrail that blocks re-prepare-after-
  // confirm.
  const pendingPreviews = await loadPendingPreviews(args.conversationId);
  const pendingPreviewNote = buildPendingPreviewNote(pendingPreviews);
  const pendingPreviewsByPrepareToolId = new Map<
    string,
    { shortHandle: string; serverSummary: string }
  >();
  for (const p of pendingPreviews) {
    // Map keyed by the *_prepare toolId so planDispatch can look up by the
    // tool name on incoming tool_calls. Prefer the latest if duplicates exist.
    pendingPreviewsByPrepareToolId.set(p.toolId, {
      shortHandle: p.shortHandle,
      serverSummary: p.serverSummary,
    });
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: agent.instructions },
    ...history,
    ...(pendingPreviewNote ? [{ role: "system" as const, content: pendingPreviewNote }] : []),
    { role: "user", content: args.userMessageContent },
  ];

  const toolCallSummaries: ChatToolCallSummary[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let finalText = "";
  let containsWrites = false;

  const model = agent.llmModel as ResolvedModel;

  // Resolve the provider API key once per turn — per-agent Secret override
  // takes precedence over the env-var pattern. The adapter receives the
  // pre-resolved key via AdapterRequest.apiKey (Pass 3).
  const apiKey = await resolveProviderApiKey({
    agentSecretId: agent.secretId,
    providerSlug: agent.llmModel.provider.slug,
    apiKeyEnvVar: agent.llmModel.provider.apiKeyEnvVar,
  });

  // Per-tool approval policy in effect for this conversation. Chat-driven
  // runs only enforce 'forbidden' — 'requires_approval' falls through to
  // the existing *_prepare/*_submit confirmation pattern, which IS the
  // human-in-the-loop approval. Empty {} preserves the legacy "no gates"
  // behavior for the seeded Platform Assistant until an admin opts in.
  const approvalPolicy = (agent.toolApprovalPolicy ?? {}) as Parameters<typeof decidePolicy>[0];

  // Dispatch through the ProviderAdapter selected from the agent's
  // modelProvider field. Agents created before Pass 2 default to
  // 'openai_compat' and behave identically to the previous streamChat path;
  // Anthropic and Gemini agents now run on their native SDKs.
  const chatStream = (req: AdapterRequest) =>
    selectAdapter(agent.modelProvider).stream({ ...req, apiKey });

  // One splitter per turn (entire streamAgent invocation): a reasoning-capable
  // model may emit multiple `<think>` blocks across tool-call iterations, and
  // we want to persist the concatenated reasoning + total duration once.
  const splitter = new ThinkTagSplitter();

  try {
    for (let step = 0; step < agent.maxToolCalls; step++) {
      if (args.signal?.aborted) throw new Error("aborted");

      const turn = await chatStream({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        signal: args.signal,
        onTokenDelta: (text) => {
          if (!text) return;
          const chunk = splitter.push(text);
          if (chunk.reasoning) {
            args.onEvent({ event: "reasoning_token", data: { text: chunk.reasoning } });
          }
          if (chunk.content) {
            args.onEvent({ event: "token", data: { text: chunk.content } });
          }
          if (chunk.reasoningEnded) {
            args.onEvent({
              event: "reasoning_done",
              data: { durationMs: splitter.totalReasoningMs },
            });
          }
        },
      });

      tokensInput += turn.usage.input;
      tokensOutput += turn.usage.output;

      if (turn.message.content && typeof turn.message.content === "string") {
        // The adapter returns the *raw* model content (still containing any
        // `<think>` tags). Re-derive the user-visible final text from the
        // splitter so persisted history never contains stray reasoning markup.
        finalText = splitter.content;
      }

      if (turn.finishReason !== "tool_calls" || turn.toolCalls.length === 0) {
        break;
      }

      // Re-feed the assistant's message verbatim so the next chat() call has
      // the matching tool_call ids.
      messages.push(turn.message as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      // Apply the concurrency policy: reads parallel, prepares serial per
      // toolId, submits always serial. Submits beyond the first in a single
      // tool_calls array are deferred to the next turn. Also inspects the
      // user's latest message + the pending-preview list to redirect any
      // re-prepare-after-confirmation back to *_submit.
      const dispatch = planDispatch(turn.toolCalls, {
        userMessageContent: args.userMessageContent,
        pendingPreviewsByPrepareToolId,
      });
      const results = await runDispatched(dispatch, tools, toolCtx, args.onEvent, approvalPolicy);
      for (const r of results) {
        toolCallSummaries.push(r.summary);
        if (r.toolName.endsWith("_submit") && !r.summary.isError) {
          containsWrites = true;
        }
        messages.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: JSON.stringify(r.contentForLlm),
        });
      }
    }

    if (!finalText) {
      finalText =
        "I hit my tool-call limit for this turn — please rephrase or break up the request.";
      args.onEvent({
        event: "error",
        data: { message: finalText, code: "max_tool_calls" },
      });
    }

    // Flush any reasoning/content held back in the lookahead buffer (e.g. a
    // model that stopped mid-tag), then snapshot the totals for persistence.
    const tail = splitter.finalize();
    if (tail.reasoning) {
      args.onEvent({ event: "reasoning_token", data: { text: tail.reasoning } });
    }
    if (tail.content) {
      args.onEvent({ event: "token", data: { text: tail.content } });
    }
    if (tail.reasoningEnded) {
      args.onEvent({
        event: "reasoning_done",
        data: { durationMs: splitter.totalReasoningMs },
      });
    }
    // Prefer the splitter's accumulated content over whatever the last turn
    // happened to set (covers max-tool-calls and other edge paths where the
    // final `finalText` came from a fallback string rather than the stream).
    if (splitter.content) {
      finalText = splitter.content;
    }
    const reasoning = splitter.reasoning || null;
    const reasoningDurationMs = reasoning ? splitter.totalReasoningMs : null;

    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        output: { toolCalls: toolCallSummaries, finalText } as unknown as Prisma.InputJsonValue,
        tokensInput,
        tokensOutput,
        costUsd,
        containsWrites,
        finishedAt: new Date(),
      },
    });

    return { agentRunId: run.id, containsWrites, finalText, reasoning, reasoningDurationMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const costUsd = computeCostUsd(model, { input: tokensInput, output: tokensOutput });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: message.slice(0, 2000),
        output: { toolCalls: toolCallSummaries, finalText } as unknown as Prisma.InputJsonValue,
        tokensInput,
        tokensOutput,
        costUsd,
        containsWrites,
        finishedAt: new Date(),
      },
    });
    args.onEvent({ event: "error", data: { message } });
    // Best-effort: still surface any reasoning collected before the failure so
    // the persisted message reflects what actually happened mid-stream.
    const partialReasoning = splitter.reasoning || null;
    const partialDurationMs = partialReasoning ? splitter.totalReasoningMs : null;
    return {
      agentRunId: run.id,
      containsWrites,
      finalText: finalText || `[error] ${message}`,
      reasoning: partialReasoning,
      reasoningDurationMs: partialDurationMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool-call dispatch planner
// ---------------------------------------------------------------------------

interface DispatchPlan {
  parallel: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  serial: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  deferred: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  /** Submits that ran in the same turn as their matching prepare. */
  confirmationGated: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  /** Prepare calls intercepted because the user just confirmed and a fresh preview already */
  redirectedToSubmit: Array<{
    tc: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
    pendingPreview: { shortHandle: string; serverSummary: string };
  }>;
}

interface PlanDispatchInputs {
  userMessageContent: string;
  pendingPreviewsByPrepareToolId: Map<string, { shortHandle: string; serverSummary: string }>;
}

function planDispatch(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[],
  inputs: PlanDispatchInputs,
): DispatchPlan {
  const plan: DispatchPlan = {
    parallel: [],
    serial: [],
    deferred: [],
    confirmationGated: [],
    redirectedToSubmit: [],
  };
  // Track in-turn prepare toolIds and whether we've already taken a submit.
  const seenPrepareIds = new Set<string>();
  let submitTaken = false;

  // Pre-compute which prepare names appear in this turn so we can refuse
  // any submit whose matching prepare is also being called now.
  const prepareNamesInTurn = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.function.name.endsWith("_prepare")) prepareNamesInTurn.add(tc.function.name);
  }

  const userJustConfirmed = looksLikeConfirmation(inputs.userMessageContent);

  for (const tc of toolCalls) {
    const name = tc.function.name;
    if (name.endsWith("_submit")) {
      const matchingPrepare = name.replace(/_submit$/, "_prepare");
      if (prepareNamesInTurn.has(matchingPrepare)) {
        // Confirmation gate: we will not run a submit in the same turn as
        // its matching prepare.
        plan.confirmationGated.push(tc);
      } else if (submitTaken) {
        // Always serial. Only one per turn — the rest defer.
        plan.deferred.push(tc);
      } else {
        plan.serial.push(tc);
        submitTaken = true;
      }
    } else if (name.endsWith("_prepare")) {
      // Inverse confirmation gate: if the user just confirmed and a fresh
      // preview already exists for this prepare's toolId, the model should
      // be calling *_submit, not re-preparing. Redirect it.
      const existing = inputs.pendingPreviewsByPrepareToolId.get(name);
      if (userJustConfirmed && existing) {
        plan.redirectedToSubmit.push({ tc, pendingPreview: existing });
        continue;
      }
      // Serial per toolId in the same turn (collisions defer).
      if (seenPrepareIds.has(name)) {
        plan.deferred.push(tc);
      } else {
        plan.serial.push(tc);
        seenPrepareIds.add(name);
      }
    } else {
      // Reads — parallelizable.
      plan.parallel.push(tc);
    }
  }
  return plan;
}

interface DispatchedResult {
  toolCallId: string;
  toolName: string;
  /** What goes back into the LLM as the tool message. */
  contentForLlm: unknown;
  summary: ChatToolCallSummary;
}

async function runDispatched(
  plan: DispatchPlan,
  tools: RegisteredTool[],
  ctx: ToolContext,
  onEvent: (e: ChatSseEvent) => void,
  approvalPolicy: Parameters<typeof decidePolicy>[0],
): Promise<DispatchedResult[]> {
  const results: DispatchedResult[] = [];

  // Reads in parallel.
  const parallelPromises = plan.parallel.map((tc) =>
    runOne(tc, tools, ctx, onEvent, approvalPolicy),
  );
  const parallelResults = await Promise.all(parallelPromises);
  results.push(...parallelResults);

  // Serial: each prepare/submit one at a time, in submission order.
  for (const tc of plan.serial) {
    results.push(await runOne(tc, tools, ctx, onEvent, approvalPolicy));
  }

  // Deferred: emit a stub tool result so the protocol stays consistent (every
  // tool_call_id needs a tool reply or the next chat() call rejects).
  for (const tc of plan.deferred) {
    const deferred: DispatchedResult = {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: {
        code: "defer_to_next_turn",
        message: "Deferred — re-evaluate before re-emitting.",
      },
      summary: {
        name: tc.function.name,
        input: safeParse(tc.function.arguments),
        output: { code: "defer_to_next_turn" },
        durationMs: 0,
        isError: false,
      },
    };
    onEvent({
      event: "tool_call_start",
      data: { id: tc.id, name: tc.function.name, args: safeParseObj(tc.function.arguments) },
    });
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, result: deferred.contentForLlm },
    });
    results.push(deferred);
  }

  // Redirected-to-submit: model called *_prepare for an action that already
  // has a fresh preview AND the user just confirmed. Refuse with the existing
  // handle so the model emits *_submit next iteration instead of superseding
  // and chasing a hallucinated cuid.
  for (const { tc, pendingPreview } of plan.redirectedToSubmit) {
    const submitTool = tc.function.name.replace(/_prepare$/, "_submit");
    const refusal = {
      code: "duplicate_prepare_blocked" as const,
      pendingPreviewHandle: pendingPreview.shortHandle,
      submitTool,
      message: `User just confirmed and a fresh preview "${pendingPreview.shortHandle}" is awaiting submission for this action (${pendingPreview.serverSummary}). Call ${submitTool}({ handle: "${pendingPreview.shortHandle}" }) instead of re-preparing. Do NOT supersede the existing preview.`,
    };
    const dispatched: DispatchedResult = {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: refusal,
      summary: {
        name: tc.function.name,
        input: safeParse(tc.function.arguments),
        output: refusal,
        durationMs: 0,
        // Held back by policy, not a tool failure.
        isError: false,
      },
    };
    onEvent({
      event: "tool_call_start",
      data: { id: tc.id, name: tc.function.name, args: safeParseObj(tc.function.arguments) },
    });
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, result: refusal },
    });
    results.push(dispatched);
  }

  // Confirmation-gated: a submit was called in the same turn as its matching
  // prepare. Refuse with a clear, model-actionable message so the model asks
  // the user to confirm and then re-emits submit on the next turn.
  for (const tc of plan.confirmationGated) {
    const message =
      'Refused: cannot run a *_submit tool in the same turn as its matching *_prepare. Wait for the user to explicitly confirm ("yes", "proceed", "Confirm submission") in the NEXT turn, then call this submit with the prv_NN handle returned by the prepare just executed. For this turn, finish by paraphrasing the preview\'s serverSummary and asking for confirmation — do NOT claim the request was submitted.';
    const refusal = {
      code: "submit_blocked_pending_confirmation" as const,
      message,
    };
    const dispatched: DispatchedResult = {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: refusal,
      summary: {
        name: tc.function.name,
        input: safeParse(tc.function.arguments),
        output: refusal,
        durationMs: 0,
        // Surface in the run's tool-call summaries as a non-error event —
        // the call wasn't a failure, just held back by policy.
        isError: false,
      },
    };
    onEvent({
      event: "tool_call_start",
      data: { id: tc.id, name: tc.function.name, args: safeParseObj(tc.function.arguments) },
    });
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, result: refusal },
    });
    results.push(dispatched);
  }

  return results;
}

async function runOne(
  tc: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
  tools: RegisteredTool[],
  ctx: ToolContext,
  onEvent: (e: ChatSseEvent) => void,
  approvalPolicy: Parameters<typeof decidePolicy>[0],
): Promise<DispatchedResult> {
  const startedAt = Date.now();
  const def = tools.find((t) => t.openaiDef.function.name === tc.function.name);
  const args = safeParseObj(tc.function.arguments);

  onEvent({ event: "tool_call_start", data: { id: tc.id, name: tc.function.name, args } });

  if (!def) {
    const err = { error: `Unknown tool: ${tc.function.name}` };
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, error: { message: err.error } },
    });
    return {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: err,
      summary: {
        name: tc.function.name,
        input: args,
        output: err,
        durationMs: Date.now() - startedAt,
        isError: true,
      },
    };
  }

  // Per-tool approval policy gate. Chat-driven runs only enforce 'forbidden'
  // here — 'requires_approval' falls through to the existing
  // *_prepare/*_submit confirmation pattern (the human user IS the approver
  // in-session). 'forbidden' refuses outright with a model-actionable error.
  const policyMode = decidePolicy(approvalPolicy, tc.function.name);
  if (policyMode === "forbidden") {
    const refusal = {
      error: `Tool ${tc.function.name} forbidden by this agent's policy`,
      code: "tool_forbidden" as const,
    };
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, result: refusal },
    });
    return {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: refusal,
      summary: {
        name: tc.function.name,
        input: args,
        output: refusal,
        durationMs: Date.now() - startedAt,
        // Held back by policy, not a tool-handler failure.
        isError: false,
      },
    };
  }

  try {
    const raw = await def.handler(args, ctx);
    let contentForLlm: unknown = raw;
    let outputForSummary: unknown = raw;

    if (isPrepareEnvelope(raw)) {
      contentForLlm = raw.forLlm;
      outputForSummary = raw.forLlm;
      onEvent({ event: "preview", data: raw.__previewEvent });
    }

    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, result: contentForLlm },
    });
    return {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm,
      summary: {
        name: tc.function.name,
        input: args,
        output: outputForSummary,
        durationMs: Date.now() - startedAt,
        isError: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent({
      event: "tool_call_end",
      data: { id: tc.id, name: tc.function.name, error: { message } },
    });
    return {
      toolCallId: tc.id,
      toolName: tc.function.name,
      contentForLlm: { error: message },
      summary: {
        name: tc.function.name,
        input: args,
        output: { error: message },
        durationMs: Date.now() - startedAt,
        isError: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// History loading
// ---------------------------------------------------------------------------

async function loadHistory(
  conversationId: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  // Pull recent messages and their tool-call payloads. We then truncate to
  // the last MAX_HISTORY_PAIRS user/assistant pairs while keeping the
  // assistant's tool_call + tool result messages adjacent.
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, toolCalls: true },
  });

  const userAssistantPairs: { user?: (typeof rows)[number]; assistant?: (typeof rows)[number] }[] =
    [];
  let cursor: { user?: (typeof rows)[number]; assistant?: (typeof rows)[number] } = {};
  for (const r of rows) {
    if (r.role === "user") {
      if (cursor.user || cursor.assistant) {
        userAssistantPairs.push(cursor);
        cursor = {};
      }
      cursor.user = r;
    } else if (r.role === "assistant") {
      cursor.assistant = r;
      userAssistantPairs.push(cursor);
      cursor = {};
    }
  }
  if (cursor.user || cursor.assistant) userAssistantPairs.push(cursor);

  const tail = userAssistantPairs.slice(-MAX_HISTORY_PAIRS);

  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const pair of tail) {
    if (pair.user) out.push({ role: "user", content: pair.user.content });
    if (pair.assistant) {
      // Persist the assistant text — tool calls in history are best-effort
      // because the original tool_call ids are lost; v2 may store the raw
      // OpenAI message. For now we emit assistant text only, which the model
      // can read back as conversational history.
      out.push({ role: "assistant", content: pair.assistant.content });
    }
  }
  return out;
}

/** A pending ChatActionPreview row in a shape both the system-note builder and the */
interface PendingPreview {
  shortHandle: string;
  toolId: string;
  serverSummary: string;
}

/** Load previews still awaiting confirmation in this conversation: unconsumed, non-superseded, */
async function loadPendingPreviews(conversationId: string): Promise<PendingPreview[]> {
  return prisma.chatActionPreview.findMany({
    where: {
      conversationId,
      consumedAt: null,
      supersededAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    select: { shortHandle: true, toolId: true, serverSummary: true },
  });
}

/** Render the pending-preview list as a system-message note. */
function buildPendingPreviewNote(pending: PendingPreview[]): string | null {
  if (pending.length === 0) return null;
  const lines = pending.map((p) => {
    const submitTool = p.toolId.replace(/_prepare$/, "_submit");
    return `- handle "${p.shortHandle}" → ${submitTool} — ${p.serverSummary}`;
  });
  return [
    "Previews awaiting confirmation in this conversation:",
    ...lines,
    'If the user just confirmed (e.g. "yes", "proceed", "go ahead", "Confirm submission"), call the matching *_submit tool with the handle shown above. Do NOT re-call *_prepare for the same action — that would supersede the existing preview without submitting it.',
  ].join("\n");
}

// Tight confirmation detector. Used by the dispatch-time guardrail to decide
// whether a *_prepare tool call should be redirected to the matching *_submit
// (because the user is confirming an existing pending preview, not asking for
// a fresh prepare). Conservative on purpose: short, contains a confirmation
// keyword, no change-indicating words.
const CONFIRMATION_KEYWORDS = [
  "yes",
  "yeah",
  "yep",
  "proceed",
  "confirm",
  "submit",
  "go ahead",
  "do it",
  "ok",
  "okay",
  "sounds good",
  "looks good",
  "create it",
  "confirm submission",
];
const CONFIRMATION_CONTRADICTIONS = [
  "change",
  "instead",
  "actually",
  "wait",
  "no ",
  "different",
  "edit",
  "update",
  "not ",
  "cancel",
  "stop",
];

function looksLikeConfirmation(text: string | undefined | null): boolean {
  if (!text) return false;
  const norm = text.trim().toLowerCase();
  if (norm.length === 0 || norm.length > 60) return false;
  // Pad with spaces so word-boundary checks like "no " also match end-of-string.
  const padded = ` ${norm} `;
  if (CONFIRMATION_CONTRADICTIONS.some((c) => padded.includes(c))) return false;
  return CONFIRMATION_KEYWORDS.some(
    (k) => padded.includes(` ${k} `) || padded.includes(`${k} `) || padded.includes(` ${k}`),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function safeParseObj(s: string | undefined): Record<string, unknown> {
  const v = safeParse(s);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
