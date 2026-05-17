import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type {
  ChatConversationSummaryDto,
  ChatConversationDetailDto,
  ChatMessageDto,
  ChatToolCallSummary,
  ChatRole,
  ChatSseEvent,
} from "@internal/shared-types";
import { streamAgent } from "./streamExecutor";

// /api/chat router — conversation CRUD plus the SSE message endpoint and a
// small abort endpoint that signals the in-flight AbortController.
//
// All routes require an authenticated user (mounted under requireAuth in
// apps/api/createServer). Conversations are scoped to req.user.id; cross-user
// access returns 404 rather than 403 to avoid leaking conversation existence.

export const chatRouter: Router = Router();

const PLATFORM_ASSISTANT_AGENT_ID = "seed-agent-assistant";
const MAX_CONCURRENT_SSE_PER_USER = 2;

// In-process map of in-flight streaming connections. Keyed by conversationId
// so /abort can find the controller; values include userId so we can also
// count concurrent connections per user. Multi-instance deployments need
// sticky sessions on conversationId — see streamExecutor.ts notes.
interface InFlightEntry {
  userId: string;
  controller: AbortController;
}
const inFlight: Map<string, InFlightEntry> = new Map();

function countInFlightForUser(userId: string): number {
  let n = 0;
  for (const v of inFlight.values()) if (v.userId === userId) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createConversationSchema = z.object({ title: z.string().min(1).max(200).optional() });
const sendMessageSchema = z.object({ content: z.string().min(1).max(8000) });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, team: { deletedAt: null } },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

function toRole(s: string): ChatRole {
  return s === "user" ? "user" : "assistant";
}

function toMessageDto(row: {
  id: string;
  role: string;
  content: string;
  toolCalls: unknown;
  agentRunId: string | null;
  reasoning: string | null;
  reasoningDurationMs: number | null;
  createdAt: Date;
}): ChatMessageDto {
  return {
    id: row.id,
    role: toRole(row.role),
    content: row.content,
    toolCalls: (row.toolCalls as ChatToolCallSummary[] | null) ?? null,
    agentRunId: row.agentRunId,
    reasoning: row.reasoning,
    reasoningDurationMs: row.reasoningDurationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findConversation(conversationId: string, userId: string) {
  return prisma.chatConversation.findFirst({
    where: { id: conversationId, userId },
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

chatRouter.get("/conversations", async (req, res) => {
  const userId = req.user!.id;
  const rows = await prisma.chatConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        where: { role: "assistant" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const dto: ChatConversationSummaryDto[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastAssistantAt: r.messages[0]?.createdAt.toISOString() ?? null,
  }));
  res.json(dto);
});

chatRouter.post("/conversations", async (req, res) => {
  const userId = req.user!.id;
  const parsed = createConversationSchema.parse(req.body ?? {});
  const conv = await prisma.chatConversation.create({
    data: {
      userId,
      agentId: PLATFORM_ASSISTANT_AGENT_ID,
      title: parsed.title ?? "New chat",
    },
  });
  const dto: ChatConversationSummaryDto = {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastAssistantAt: null,
  };
  res.status(201).json(dto);
});

chatRouter.get("/conversations/:id", async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const conv = await findConversation(id, userId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      toolCalls: true,
      agentRunId: true,
      reasoning: true,
      reasoningDurationMs: true,
      createdAt: true,
    },
  });
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const dto: ChatConversationDetailDto = {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastAssistantAt: lastAssistant?.createdAt.toISOString() ?? null,
    messages: messages.map(toMessageDto),
  };
  res.json(dto);
});

chatRouter.delete("/conversations/:id", async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const conv = await findConversation(id, userId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  // Cancel any in-flight stream for this conversation before cascading the
  // delete so the streamExecutor's persist-on-finish doesn't fight a deleted
  // FK.
  const flight = inFlight.get(id);
  if (flight) {
    flight.controller.abort();
    inFlight.delete(id);
  }
  await prisma.chatConversation.delete({ where: { id } });
  res.status(204).end();
});

chatRouter.post("/conversations/:id/abort", async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const flight = inFlight.get(id);
  if (!flight || flight.userId !== userId) {
    res.status(404).json({ error: "No in-flight stream for this conversation" });
    return;
  }
  flight.controller.abort();
  res.status(204).end();
});

chatRouter.post("/conversations/:id/messages", async (req, res) => {
  const user = req.user!;
  const { id: conversationId } = req.params;
  const parsed = sendMessageSchema.parse(req.body ?? {});

  const conv = await findConversation(conversationId, user.id);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Concurrent SSE cap (per-user). Hits before we open the stream so the
  // client gets a normal JSON 429 instead of an SSE error frame.
  if (countInFlightForUser(user.id) >= MAX_CONCURRENT_SSE_PER_USER) {
    res.status(429).json({
      error: "Too many concurrent chat streams open",
      code: "concurrent_limit",
    });
    return;
  }

  // Persist the user's message before streaming so the transcript stays
  // intact even if the network drops mid-stream.
  const userMsg = await prisma.chatMessage.create({
    data: { conversationId, role: "user", content: parsed.content },
  });

  // Lazy-title: the first user message becomes the conversation title.
  if (conv.title === "New chat") {
    const trimmed =
      parsed.content.length > 80 ? parsed.content.slice(0, 77) + "..." : parsed.content;
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { title: trimmed },
    });
  }

  // SSE response headers. Disable proxy buffering so tokens arrive promptly.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Wire up the abort controller for this turn.
  const controller = new AbortController();
  inFlight.set(conversationId, { userId: user.id, controller });
  // If the client disconnects, treat it as an abort.
  req.on("close", () => controller.abort());

  function writeEvent(e: ChatSseEvent): void {
    res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  }

  try {
    const teamIds = await getCallerTeamIds(user.id);
    const result = await streamAgent({
      agentId: PLATFORM_ASSISTANT_AGENT_ID,
      conversationId,
      userMessageContent: parsed.content,
      callerUserId: user.id,
      callerIsAdmin: user.role === "admin",
      callerTeamIds: teamIds,
      signal: controller.signal,
      onEvent: writeEvent,
    });

    // Persist the assistant message — captures finalText, the run id, and
    // the tool calls so reload-of-conversation renders the full transcript
    // including chips. Reasoning (if any) is saved alongside so the collapsed
    // "Reasoned - Ns" affordance can re-expand its text after reload.
    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: result.finalText,
        agentRunId: result.agentRunId,
        toolCalls: undefined, // tool calls already streamed; reconstruct from AgentRun if needed for v2
        reasoning: result.reasoning,
        reasoningDurationMs: result.reasoningDurationMs,
      },
    });

    // Bump the conversation's updatedAt so the rail re-orders.
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    writeEvent({
      event: "done",
      data: {
        agentRunId: result.agentRunId,
        finalText: result.finalText,
        containsWrites: result.containsWrites,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeEvent({ event: "error", data: { message } });
    // Save a [aborted] / [error] message so the transcript stays consistent.
    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: controller.signal.aborted ? "[aborted]" : `[error] ${message}`,
      },
    });
  } finally {
    inFlight.delete(conversationId);
    res.end();
  }

  // Reference userMsg so eslint doesn't flag the assignment as unused — the
  // row exists for transcript persistence; we don't need to read it back.
  void userMsg;
});
