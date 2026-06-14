import OpenAI from "openai";
import { prisma, Prisma } from "@internal/db";
import {
  computeCostUsd,
  mcpOAuthRedirectUrl,
  openAgentMcpToolset,
  providerKindFromProvider,
  resolveProviderApiKey,
  resolveTools,
  selectAdapter,
  type AdapterRequest,
  type McpToolset,
  type ResolvedModel,
  type RegisteredTool,
  type ToolContext,
} from "@internal/llm-core";
import type { ChatSseEvent, ChatToolCallSummary, ChatPolicyCheck } from "@internal/shared-types";
import { platformAssistantReadToolIds } from "@feature/agent-tools-backend/contract";
import { chatWriteToolIds } from "./tools";
import { composeUserContent } from "./imageExtraction";
import { ThinkTagSplitter } from "./thinkTagSplitter";

// SSE streaming chat loop: multi-turn tool dispatch with prepare/submit confirmation, reasoning split, and AgentRun persistence.

const PLATFORM_ASSISTANT_AGENT_ID = "seed-agent-assistant";

export class ChatNotConfiguredError extends Error {
  readonly code = "not_configured";
  readonly reason: string;
  constructor(reason: string) {
    super(`Chat is not configured: ${reason}`);
    this.reason = reason;
  }
}

const MAX_HISTORY_PAIRS = 20;

export interface StreamAgentArgs {
  agentId: string;
  conversationId: string;
  userMessageContent: string;
  // Excludes the already-persisted current user row from history so it is not sent twice.
  currentUserMessageId?: string;
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
  reasoning: string | null;
  reasoningDurationMs: number | null;
}

export interface PrepareReturnEnvelope {
  __previewEvent: {
    shortHandle: string;
    toolId: string;
    serverSummary: string;
    parsedParams: Record<string, unknown>;
    sideEffects: string[];
    policyChecks: ChatPolicyCheck[];
  };
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

  const run = await prisma.agentRun.create({
    data: {
      agentId: args.agentId,
      userId: args.callerUserId,
      trigger: "chat",
      conversationId: args.conversationId,
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
  const chatCtx = toolCtx as ToolContext & {
    conversationId?: string;
    agentRunId?: string;
  };
  chatCtx.conversationId = args.conversationId;
  chatCtx.agentRunId = run.id;

  const persistedIds = Array.isArray(agent.toolIds) ? (agent.toolIds as unknown as string[]) : [];
  const toolIds =
    args.agentId === PLATFORM_ASSISTANT_AGENT_ID
      ? [...platformAssistantReadToolIds(), ...chatWriteToolIds()]
      : persistedIds;
  const baseTools = resolveTools(toolIds);
  // Merged with the agent's attached external MCP server tools just below, inside the try so the
  // toolset is always torn down in finally.
  let tools = baseTools;
  let openaiTools = baseTools.map((t) => t.openaiDef);
  let mcpToolset: McpToolset | null = null;

  const history = await loadHistory(args.conversationId, args.currentUserMessageId);

  const pendingPreviews = await loadPendingPreviews(args.conversationId);
  const pendingPreviewNote = buildPendingPreviewNote(pendingPreviews);
  const pendingPreviewsByPrepareToolId = new Map<
    string,
    { shortHandle: string; serverSummary: string }
  >();
  for (const p of pendingPreviews) {
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

  const model = agent.llmModel as ResolvedModel | null;
  if (!model || !model.enabled || !model.provider.enabled) {
    throw new ChatNotConfiguredError("model_unavailable");
  }

  const apiKey = await resolveProviderApiKey({
    providerId: model.provider.id,
    providerSlug: model.provider.slug,
    apiKeyEnvVar: model.provider.apiKeyEnvVar,
    isAdmin: args.callerIsAdmin,
  });

  const chatStream = (req: AdapterRequest) =>
    selectAdapter(providerKindFromProvider(model.provider)).stream({ ...req, apiKey });

  const splitter = new ThinkTagSplitter();

  try {
    // Pull in the agent's external MCP server tools. A server that needs the caller to authorize via
    // OAuth surfaces as an oauth_required event, the turn still runs with whatever tools resolved.
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3010";
    mcpToolset = await openAgentMcpToolset(args.agentId, args.callerUserId, {
      redirectUrl: mcpOAuthRedirectUrl(webOrigin),
      redirectTo: `${webOrigin}/?mcp_oauth=connected`,
    });
    if (mcpToolset) {
      tools = [...baseTools, ...mcpToolset.tools];
      openaiTools = tools.map((t) => t.openaiDef);
      if (mcpToolset.needsAuth.length > 0) {
        args.onEvent({ event: "oauth_required", data: { servers: mcpToolset.needsAuth } });
      }
    }

    for (let step = 0; step < agent.maxToolCalls; step++) {
      if (args.signal?.aborted) throw new Error("aborted");

      const turn = await chatStream({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        signal: args.signal,
        temperature: agent.temperature,
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
        finalText = splitter.content;
      }

      if (turn.finishReason !== "tool_calls" || turn.toolCalls.length === 0) {
        break;
      }

      messages.push(turn.message as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      const dispatch = planDispatch(turn.toolCalls, {
        userMessageContent: args.userMessageContent,
        pendingPreviewsByPrepareToolId,
      });
      const results = await runDispatched(dispatch, tools, toolCtx, args.onEvent);
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
    const partialReasoning = splitter.reasoning || null;
    const partialDurationMs = partialReasoning ? splitter.totalReasoningMs : null;
    return {
      agentRunId: run.id,
      containsWrites,
      finalText: finalText || `[error] ${message}`,
      reasoning: partialReasoning,
      reasoningDurationMs: partialDurationMs,
    };
  } finally {
    if (mcpToolset) await mcpToolset.close();
  }
}

interface DispatchPlan {
  parallel: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  serial: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  deferred: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
  confirmationGated: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
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
  const seenPrepareIds = new Set<string>();
  let submitTaken = false;

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
        plan.confirmationGated.push(tc);
      } else if (submitTaken) {
        plan.deferred.push(tc);
      } else {
        plan.serial.push(tc);
        submitTaken = true;
      }
    } else if (name.endsWith("_prepare")) {
      const existing = inputs.pendingPreviewsByPrepareToolId.get(name);
      if (userJustConfirmed && existing) {
        plan.redirectedToSubmit.push({ tc, pendingPreview: existing });
        continue;
      }
      if (seenPrepareIds.has(name)) {
        plan.deferred.push(tc);
      } else {
        plan.serial.push(tc);
        seenPrepareIds.add(name);
      }
    } else {
      plan.parallel.push(tc);
    }
  }
  return plan;
}

interface DispatchedResult {
  toolCallId: string;
  toolName: string;
  contentForLlm: unknown;
  summary: ChatToolCallSummary;
}

async function runDispatched(
  plan: DispatchPlan,
  tools: RegisteredTool[],
  ctx: ToolContext,
  onEvent: (e: ChatSseEvent) => void,
): Promise<DispatchedResult[]> {
  const results: DispatchedResult[] = [];

  const parallelPromises = plan.parallel.map((tc) => runOne(tc, tools, ctx, onEvent));
  const parallelResults = await Promise.all(parallelPromises);
  results.push(...parallelResults);

  for (const tc of plan.serial) {
    results.push(await runOne(tc, tools, ctx, onEvent));
  }

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

async function loadHistory(
  conversationId: string,
  excludeMessageId?: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const allRows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, toolCalls: true, attachments: true },
  });
  const rows = allRows.filter((r) => r.id !== excludeMessageId);

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
    if (pair.user) {
      // Replays the stored extraction so follow-up questions about an image never re-run the vision model.
      const attachments = Array.isArray(pair.user.attachments)
        ? (pair.user.attachments as unknown as { extractedText: string | null }[])
        : [];
      out.push({ role: "user", content: composeUserContent(pair.user.content, attachments) });
    }
    if (pair.assistant) {
      out.push({ role: "assistant", content: pair.assistant.content });
    }
  }
  return out;
}

interface PendingPreview {
  shortHandle: string;
  toolId: string;
  serverSummary: string;
}

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
  const padded = ` ${norm} `;
  if (CONFIRMATION_CONTRADICTIONS.some((c) => padded.includes(c))) return false;
  return CONFIRMATION_KEYWORDS.some(
    (k) => padded.includes(` ${k} `) || padded.includes(`${k} `) || padded.includes(` ${k}`),
  );
}

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
