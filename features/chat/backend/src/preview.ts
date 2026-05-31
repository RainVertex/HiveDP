// ChatActionPreview lifecycle helpers used by the *_prepare and *_submit tools.
import { prisma, Prisma } from "@internal/db";
import type { ChatPolicyCheck } from "@internal/shared-types";
import type { PrepareReturnEnvelope } from "./streamExecutor";

const PREVIEW_TTL_MS = 10 * 60 * 1000; // 10 min

export interface CreatePreviewArgs {
  conversationId: string;
  userId: string;
  toolId: string;
  parsedParams: Record<string, unknown>;
  serverSummary: string;
  policyChecks: ChatPolicyCheck[];
  sideEffects: string[];
}

// Persist a preview row and supersede prior unconsumed prepares of the same kind.
export async function createPreview(args: CreatePreviewArgs): Promise<PrepareReturnEnvelope> {
  return prisma.$transaction(async (tx) => {
    // Only the latest prepare stays submittable, so the assistant can correct mid-conversation.
    await tx.chatActionPreview.updateMany({
      where: {
        conversationId: args.conversationId,
        toolId: args.toolId,
        consumedAt: null,
        supersededAt: null,
      },
      data: { supersededAt: new Date() },
    });

    // Count previews of any state so short handles never repeat per (conversationId, toolId).
    const priorCount = await tx.chatActionPreview.count({
      where: { conversationId: args.conversationId, toolId: args.toolId },
    });
    const handleIndex = priorCount + 1;
    const shortHandle = `prv_${String(handleIndex).padStart(2, "0")}`;

    const row = await tx.chatActionPreview.create({
      data: {
        shortHandle,
        conversationId: args.conversationId,
        userId: args.userId,
        toolId: args.toolId,
        parsedParams: args.parsedParams as Prisma.InputJsonValue,
        serverSummary: args.serverSummary,
        policyChecks: args.policyChecks as unknown as Prisma.InputJsonValue,
        sideEffects: args.sideEffects as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      },
      select: { id: true, shortHandle: true },
    });

    return {
      __previewEvent: {
        shortHandle: row.shortHandle,
        toolId: args.toolId,
        serverSummary: args.serverSummary,
        parsedParams: args.parsedParams,
        sideEffects: args.sideEffects,
        policyChecks: args.policyChecks,
      },
      forLlm: {
        handle: row.shortHandle,
        serverSummary: args.serverSummary,
        policyChecks: args.policyChecks,
      },
    };
  });
}

export type ResolvePreviewError =
  | { code: "not_found"; message: string }
  | { code: "wrong_user"; message: string }
  | { code: "wrong_conversation"; message: string }
  | { code: "expired"; message: string }
  | { code: "superseded"; message: string };

export type ResolvePreviewResult =
  | {
      ok: true;
      kind: "fresh";
      preview: NonNullable<Awaited<ReturnType<typeof prisma.chatActionPreview.findUnique>>>;
    }
  | { ok: true; kind: "alreadyConsumed"; resultRefId: string | null; consumedAt: Date }
  | { ok: false; error: ResolvePreviewError };

// Look up a preview by handle and run authorization + lifecycle gates.
export async function resolveForSubmit(args: {
  handle: string;
  conversationId: string;
  userId: string;
  toolId: string;
}): Promise<ResolvePreviewResult> {
  const row = await prisma.chatActionPreview.findUnique({
    where: {
      conversationId_shortHandle: { conversationId: args.conversationId, shortHandle: args.handle },
    },
  });
  if (!row || row.toolId !== args.toolId.replace(/_submit$/, "_prepare")) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `No preview ${args.handle} found for this action — call the matching *_prepare tool first.`,
      },
    };
  }
  if (row.userId !== args.userId) {
    return {
      ok: false,
      error: { code: "wrong_user", message: "This preview belongs to another user." },
    };
  }
  if (row.conversationId !== args.conversationId) {
    return {
      ok: false,
      error: {
        code: "wrong_conversation",
        message: "This preview belongs to another conversation.",
      },
    };
  }
  if (row.consumedAt) {
    // Idempotency: re-submission returns the prior result instead of re-running the handler.
    return {
      ok: true,
      kind: "alreadyConsumed",
      resultRefId: row.resultRefId,
      consumedAt: row.consumedAt,
    };
  }
  if (row.supersededAt) {
    return {
      ok: false,
      error: {
        code: "superseded",
        message: "A newer preview replaced this one — please confirm the latest preview instead.",
      },
    };
  }
  if (row.expiresAt < new Date()) {
    return {
      ok: false,
      error: {
        code: "expired",
        message: "This preview expired — please re-confirm what you'd like to do.",
      },
    };
  }
  return { ok: true, kind: "fresh", preview: row };
}

// Mark a preview as consumed and record the wrapped handler's result-id.
export async function markConsumed(args: {
  previewId: string;
  resultRefId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = args.tx ?? prisma;
  await client.chatActionPreview.update({
    where: { id: args.previewId },
    data: { consumedAt: new Date(), resultRefId: args.resultRefId },
  });
}
