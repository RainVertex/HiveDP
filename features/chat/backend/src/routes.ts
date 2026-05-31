// /api/chat router: conversation CRUD, the SSE message stream, and stream abort. All routes are auth-scoped to req.user.id (cross-user access 404s).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type {
  ChatConversationSummaryDto,
  ChatConversationDetailDto,
  ChatConfigDto,
  ChatMessageDto,
  ChatToolCallSummary,
  ChatRole,
  ChatSseEvent,
} from "@internal/shared-types";
import {
  getSetting,
  isProviderReady,
  providerHasStoredKey,
  assistantNotConfiguredMessage,
} from "@internal/llm-core";
import { streamAgent } from "./streamExecutor";

export const chatRouter: Router = Router();

const PLATFORM_ASSISTANT_AGENT_ID = "seed-agent-assistant";
const MAX_CONCURRENT_SSE_PER_USER = 2;

// In-flight SSE connections keyed by conversationId; multi-instance deploys need sticky sessions on conversationId.
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

const createConversationSchema = z.object({ title: z.string().min(1).max(200).optional() });
const sendMessageSchema = z.object({ content: z.string().min(1).max(8000) });

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

// Resolves the per-conversation agent identity so summaries carry the avatar before the first detail fetch.
async function loadAgentIdentities(
  agentIds: string[],
): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return new Map();
  const agents = await prisma.agent.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, avatarUrl: true },
  });
  return new Map(agents.map((a) => [a.id, { name: a.name, avatarUrl: a.avatarUrl }]));
}

async function resolveChatReadiness(): Promise<{ ready: boolean; reason: string | null }> {
  const activeModelId = await getSetting<string>("chat.activeModelId");
  if (!activeModelId) return { ready: false, reason: "no_active_model" };
  const model = await prisma.llmModel.findUnique({
    where: { id: activeModelId },
    include: { provider: true },
  });
  if (!model || !model.enabled || !model.provider.enabled) {
    return { ready: false, reason: "model_unavailable" };
  }
  const hasStoredKey = await providerHasStoredKey(model.provider.id);
  if (!isProviderReady(model.provider, hasStoredKey)) {
    return { ready: false, reason: "model_unavailable" };
  }
  return { ready: true, reason: null };
}

chatRouter.get("/config", async (_req, res) => {
  const { ready, reason } = await resolveChatReadiness();
  const dto: ChatConfigDto = { ready, reason };
  res.json(dto);
});

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
  const agents = await loadAgentIdentities(rows.map((r) => r.agentId));
  const dto: ChatConversationSummaryDto[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastAssistantAt: r.messages[0]?.createdAt.toISOString() ?? null,
    assistantName: agents.get(r.agentId)?.name ?? null,
    assistantAvatarUrl: agents.get(r.agentId)?.avatarUrl ?? null,
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
  const agent = await prisma.agent.findUnique({
    where: { id: conv.agentId },
    select: { name: true, avatarUrl: true },
  });
  const dto: ChatConversationSummaryDto = {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastAssistantAt: null,
    assistantName: agent?.name ?? null,
    assistantAvatarUrl: agent?.avatarUrl ?? null,
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
  const agent = await prisma.agent.findUnique({
    where: { id: conv.agentId },
    select: { name: true, avatarUrl: true },
  });
  const dto: ChatConversationDetailDto = {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastAssistantAt: lastAssistant?.createdAt.toISOString() ?? null,
    messages: messages.map(toMessageDto),
    assistantName: agent?.name ?? null,
    assistantAvatarUrl: agent?.avatarUrl ?? null,
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
  // Abort any in-flight stream first so persist-on-finish does not race the cascading delete.
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

  // Block before opening the SSE so an unconfigured assistant returns a clean JSON 409, not an SSE error frame.
  const readiness = await resolveChatReadiness();
  if (!readiness.ready) {
    res.status(409).json({
      error: assistantNotConfiguredMessage(user.role === "admin"),
      code: "not_configured",
      reason: readiness.reason,
    });
    return;
  }

  if (countInFlightForUser(user.id) >= MAX_CONCURRENT_SSE_PER_USER) {
    res.status(429).json({
      error: "Too many concurrent chat streams open",
      code: "concurrent_limit",
    });
    return;
  }

  // Persist the user message before streaming so the transcript survives a mid-stream network drop.
  await prisma.chatMessage.create({
    data: { conversationId, role: "user", content: parsed.content },
  });

  if (conv.title === "New chat") {
    const trimmed =
      parsed.content.length > 80 ? parsed.content.slice(0, 77) + "..." : parsed.content;
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { title: trimmed },
    });
  }

  // X-Accel-Buffering off so proxies do not buffer the token stream.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  inFlight.set(conversationId, { userId: user.id, controller });
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

    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: result.finalText,
        agentRunId: result.agentRunId,
        toolCalls: undefined,
        reasoning: result.reasoning,
        reasoningDurationMs: result.reasoningDurationMs,
      },
    });

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
});
