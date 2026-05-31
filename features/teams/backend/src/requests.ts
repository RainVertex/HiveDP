import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import { notify } from "@feature/notifications-backend";
import {
  TEAM_REQUEST_INCLUDE,
  audit,
  loadProposedUserMap,
  readGithubOrgLogin,
  requestExpiresAt,
  shapeTeamRequest,
  type TeamRequestRow,
} from "./helpers";
import { runPolicies } from "./policies";
import {
  GithubMirrorError,
  addGithubTeamMaintainer,
  addGithubTeamMember,
  bestEffortDeleteGithubTeam,
  createGithubTeam,
} from "./mirror";

// Team creation request lifecycle: submit, negotiate (propose/counter), approve/reject/cancel, with optional GitHub mirror.
export const teamRequestsRouter: Router = Router();

const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase, digits and dashes");

/** Maximum rounds (submit + propose + counter-propose) before auto-cancel. */
const MAX_ROUNDS = 3;

/** Statuses a request occupies while it's still under review or negotiation. */
const ACTIVE_STATUSES = ["pending", "awaiting_user_confirmation"] as const;

const mirrorTargetSchema = z
  .object({
    mirrorToGithub: z.boolean(),
    githubIntegrationId: z.string().min(1).optional(),
  })
  .refine((v) => !v.mirrorToGithub || (v.githubIntegrationId && v.githubIntegrationId.length > 0), {
    message: "githubIntegrationId is required when mirrorToGithub is true",
    path: ["githubIntegrationId"],
  });

/** Optional pre-staged team composition. */
const proposedMembersSchema = z.object({
  proposedMaintainerUserIds: z.array(z.string().min(1)).max(100).default([]),
  proposedMemberUserIds: z.array(z.string().min(1)).max(100).default([]),
});

const submitSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
  })
  .and(mirrorTargetSchema)
  .and(proposedMembersSchema)
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const id of v.proposedMaintainerUserIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proposedMaintainerUserIds"],
          message: "Duplicate user id in maintainers",
        });
        return;
      }
      seen.add(id);
    }
    for (const id of v.proposedMemberUserIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proposedMemberUserIds"],
          message: "User can't be both a maintainer and a member",
        });
        return;
      }
      seen.add(id);
    }
  });

teamRequestsRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const {
      slug,
      name,
      description,
      mirrorToGithub,
      githubIntegrationId,
      proposedMaintainerUserIds,
      proposedMemberUserIds,
    } = parsed.data;

    if (mirrorToGithub) {
      const ok = await validateGithubIntegration(githubIntegrationId!, res);
      if (!ok) return;
    }

    // Strip the requester from either list; they are seeded as `lead` automatically.
    const cleanedMaintainers = proposedMaintainerUserIds.filter((id) => id !== req.user!.id);
    const cleanedMembers = proposedMemberUserIds.filter((id) => id !== req.user!.id);

    const result = await createTeamRequest(
      {
        slug,
        name,
        description,
        mirrorToGithub,
        githubIntegrationId,
        proposedMaintainerUserIds: cleanedMaintainers,
        proposedMemberUserIds: cleanedMembers,
      },
      {
        requestedByUserId: req.user.id,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
      },
    );
    if (!result.ok) {
      if (result.code === "policy_violation") {
        res.status(422).json({ error: result.message, policyViolation: result.violation });
        return;
      }
      if (result.code === "user_not_found") {
        res.status(422).json({ error: result.message });
        return;
      }
      // slug_taken | duplicate_pending, both 409.
      res.status(409).json({ error: result.message });
      return;
    }
    const userMap = await loadProposedUserMap([result.request]);
    res.status(201).json(shapeTeamRequest(result.request, userMap));
  } catch (err) {
    next(err);
  }
});

// Shared by the HTTP route above and the chatbot's team_request_submit tool; chatbot passes extraAuditPayload.
export interface CreateTeamRequestInput {
  slug: string;
  name: string;
  description?: string;
  mirrorToGithub: boolean;
  githubIntegrationId?: string;
  /** Optional pre-stage. */
  proposedMaintainerUserIds?: string[];
  proposedMemberUserIds?: string[];
}

export interface CreateTeamRequestCtx {
  requestedByUserId: string;
  actorIp?: string | null;
  requestId?: string | null;
  /** Merged into the audit row's payload. */
  extraAuditPayload?: Record<string, unknown>;
}

export type CreateTeamRequestResult =
  | { ok: true; request: TeamRequestRow }
  | { ok: false; code: "policy_violation"; message: string; violation: unknown }
  | { ok: false; code: "slug_taken"; message: string }
  | { ok: false; code: "duplicate_pending"; message: string }
  | { ok: false; code: "user_not_found"; message: string };

export async function createTeamRequest(
  input: CreateTeamRequestInput,
  ctx: CreateTeamRequestCtx,
): Promise<CreateTeamRequestResult> {
  const slug = input.slug;
  const name = input.name;
  const description = input.description;
  const mirrorToGithub = input.mirrorToGithub;
  const githubIntegrationId = input.githubIntegrationId;
  const proposedMaintainerUserIds = input.proposedMaintainerUserIds ?? [];
  const proposedMemberUserIds = input.proposedMemberUserIds ?? [];

  const violation = await runPolicies({ slug, name, description: description ?? null });
  if (violation) {
    return {
      ok: false,
      code: "policy_violation",
      message: violation.message,
      violation,
    };
  }

  const liveTeamWithSlug = await prisma.team.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true },
  });
  if (liveTeamWithSlug) {
    return {
      ok: false,
      code: "slug_taken",
      message: "A team with this slug already exists",
    };
  }

  // Verify picked users exist before the transaction; later deletes are handled at approval time.
  const allProposedIds = [...proposedMaintainerUserIds, ...proposedMemberUserIds];
  if (allProposedIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: allProposedIds } },
      select: { id: true },
    });
    if (found.length !== new Set(allProposedIds).size) {
      return {
        ok: false,
        code: "user_not_found",
        message: "One or more selected users no longer exist",
      };
    }
  }

  try {
    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.teamRequest.create({
        data: {
          slug,
          name,
          description: description ?? null,
          requestedByUserId: ctx.requestedByUserId,
          status: "pending",
          mirrorToGithub,
          githubIntegrationId: mirrorToGithub ? githubIntegrationId! : null,
          roundCount: 1,
          lastEditedByUserId: ctx.requestedByUserId,
          originalSlug: slug,
          originalName: name,
          originalDescription: description ?? null,
          originalMirrorToGithub: mirrorToGithub,
          originalGithubIntegrationId: mirrorToGithub ? githubIntegrationId! : null,
          proposedMaintainerUserIds,
          proposedMemberUserIds,
          expiresAt: requestExpiresAt(),
        },
        include: TEAM_REQUEST_INCLUDE,
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: ctx.requestedByUserId,
          actorIp: ctx.actorIp ?? null,
          requestId: ctx.requestId ?? null,
          kind: "team.request.submitted",
          targetKind: "teamRequest",
          targetId: created.id,
          payload: {
            requestId: created.id,
            slug,
            requestedByUserId: ctx.requestedByUserId,
            mirrorToGithub,
            githubIntegrationId: created.githubIntegrationId,
            proposedMaintainerCount: proposedMaintainerUserIds.length,
            proposedMemberCount: proposedMemberUserIds.length,
            ...(ctx.extraAuditPayload ?? {}),
          } as Prisma.InputJsonValue,
        },
      });
      await fanoutAdminSubmitted(tx, created);
      return created;
    });
    return { ok: true, request };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        code: "duplicate_pending",
        message: "An open request for this slug already exists",
      };
    }
    throw err;
  }
}

teamRequestsRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const isAdmin = req.user.role === "admin";
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where: Prisma.TeamRequestWhereInput = {
      ...(isAdmin ? {} : { requestedByUserId: req.user.id }),
      ...(status ? { status: status as Prisma.TeamRequestWhereInput["status"] } : {}),
    };
    const items = await prisma.teamRequest.findMany({
      where,
      include: TEAM_REQUEST_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const userMap = await loadProposedUserMap(items);
    res.json({ items: items.map((r) => shapeTeamRequest(r, userMap)) });
  } catch (err) {
    next(err);
  }
});

// Admin-only approver view: pending team requests plus history I reviewed.
teamRequestsRouter.get("/for-me-as-approver", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const myId = req.user.id;
    const items = await prisma.teamRequest.findMany({
      where: {
        OR: [
          { status: { in: ["pending", "awaiting_user_confirmation"] } },
          { reviewedByUserId: myId },
        ],
      },
      include: TEAM_REQUEST_INCLUDE,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    const userMap = await loadProposedUserMap(items);
    res.json({ items: items.map((r) => shapeTeamRequest(r, userMap)) });
  } catch (err) {
    next(err);
  }
});

teamRequestsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const request = await prisma.teamRequest.findUnique({
      where: { id: req.params.id },
      include: TEAM_REQUEST_INCLUDE,
    });
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && request.requestedByUserId !== req.user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const userMap = await loadProposedUserMap([request]);
    res.json(shapeTeamRequest(request, userMap));
  } catch (err) {
    next(err);
  }
});

const proposeSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  mirrorToGithub: z.boolean().optional(),
  githubIntegrationId: z.string().min(1).nullable().optional(),
});

teamRequestsRouter.post("/:id/propose", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = proposeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    await applyEdit(req, res, req.params.id, "admin", parsed.data);
  } catch (err) {
    next(err);
  }
});

const respondSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z
    .object({
      action: z.literal("counter"),
      slug: slugSchema.optional(),
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(1000).nullable().optional(),
      mirrorToGithub: z.boolean().optional(),
      githubIntegrationId: z.string().min(1).nullable().optional(),
    })
    .strict(),
]);

teamRequestsRouter.post("/:id/respond", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const existing = await prisma.teamRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.requestedByUserId !== req.user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (existing.status !== "awaiting_user_confirmation") {
      res.status(409).json({ error: `Request is ${existing.status}` });
      return;
    }

    if (parsed.data.action === "confirm") {
      // The admin's prior propose is the approval; that admin (lastEditedByUserId) is the reviewer.
      await runApproval(req, res, existing.id, {
        confirmedByRequester: true,
      });
      return;
    }

    const { action: _, ...edit } = parsed.data;
    void _;
    await applyEdit(req, res, existing.id, "user", edit);
  } catch (err) {
    next(err);
  }
});

// Applies a propose (admin) or counter-propose (user) edit, enforcing the round cap.
async function applyEdit(
  req: Request,
  res: import("express").Response,
  requestId: string,
  by: "admin" | "user",
  edit: {
    slug?: string;
    name?: string;
    description?: string | null;
    mirrorToGithub?: boolean;
    githubIntegrationId?: string | null;
  },
): Promise<void> {
  const existing = await prisma.teamRequest.findUnique({
    where: { id: requestId },
    include: TEAM_REQUEST_INCLUDE,
  });
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  if (by === "admin") {
    if (existing.status !== "pending") {
      res.status(409).json({ error: `Request is ${existing.status}` });
      return;
    }
  } else {
    if (existing.status !== "awaiting_user_confirmation") {
      res.status(409).json({ error: `Request is ${existing.status}` });
      return;
    }
  }

  const nextRound = existing.roundCount + 1;

  if (nextRound > MAX_ROUNDS) {
    const cancelled = await prisma.$transaction(async (tx) => {
      const updated = await tx.teamRequest.update({
        where: { id: existing.id },
        data: {
          status: "cancelled",
          autoCancelReason: "round_limit",
          reviewedAt: new Date(),
        },
        include: TEAM_REQUEST_INCLUDE,
      });
      await audit(
        tx,
        req,
        "team.request.auto_cancelled",
        { requestId: existing.id, slug: existing.slug, reason: "round_limit" },
        { kind: "teamRequest", id: existing.id },
      );
      await notify(tx, {
        recipientUserId: existing.requestedByUserId,
        kind: "team.request.auto_cancelled",
        payload: {
          requestId: existing.id,
          slug: existing.slug,
          reason: "round_limit",
        },
      });
      const admins = await tx.user.findMany({
        where: { role: "admin" },
        select: { id: true },
      });
      for (const a of admins) {
        if (a.id === existing.requestedByUserId) continue;
        await notify(tx, {
          recipientUserId: a.id,
          kind: "team.request.auto_cancelled",
          payload: {
            requestId: existing.id,
            slug: existing.slug,
            reason: "round_limit",
            requestedByDisplayName: existing.requestedBy.displayName,
          },
        });
      }
      return updated;
    });
    const userMap = await loadProposedUserMap([cancelled]);
    res.status(409).json({
      error: "Negotiation round limit reached; request auto-cancelled.",
      autoCancelReason: "round_limit",
      request: shapeTeamRequest(cancelled, userMap),
    });
    return;
  }

  const merged = {
    slug: edit.slug ?? existing.slug,
    name: edit.name ?? existing.name,
    description: edit.description !== undefined ? edit.description : existing.description,
    mirrorToGithub: edit.mirrorToGithub ?? existing.mirrorToGithub,
    githubIntegrationId:
      edit.githubIntegrationId !== undefined
        ? edit.githubIntegrationId
        : existing.githubIntegrationId,
  };
  if (merged.mirrorToGithub && !merged.githubIntegrationId) {
    res.status(400).json({
      error: "githubIntegrationId is required when mirrorToGithub is true",
    });
    return;
  }
  if (merged.mirrorToGithub) {
    const ok = await validateGithubIntegration(merged.githubIntegrationId!, res);
    if (!ok) return;
  }

  const violation = await runPolicies({
    slug: merged.slug,
    name: merged.name,
    description: merged.description ?? null,
  });
  if (violation) {
    res.status(422).json({ error: violation.message, policyViolation: violation });
    return;
  }

  if (merged.slug !== existing.slug) {
    const liveCollision = await prisma.team.findFirst({
      where: { slug: merged.slug, deletedAt: null },
      select: { id: true },
    });
    if (liveCollision) {
      res.status(409).json({ error: "A team with this slug already exists" });
      return;
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.teamRequest.update({
        where: { id: existing.id },
        data: {
          slug: merged.slug,
          name: merged.name,
          description: merged.description,
          mirrorToGithub: merged.mirrorToGithub,
          githubIntegrationId: merged.mirrorToGithub ? merged.githubIntegrationId! : null,
          roundCount: nextRound,
          lastEditedByUserId: req.user!.id,
          status: by === "admin" ? "awaiting_user_confirmation" : "pending",
          // Counter-proposal (user) extends the TTL; admin propose does not.
          ...(by === "user" ? { expiresAt: requestExpiresAt() } : {}),
        },
        include: TEAM_REQUEST_INCLUDE,
      });
      if (by === "admin") {
        await audit(
          tx,
          req,
          "team.request.changes_proposed",
          {
            requestId: existing.id,
            slug: merged.slug,
            reviewedByUserId: req.user!.id,
            roundCount: nextRound,
          },
          { kind: "teamRequest", id: existing.id },
        );
        await notify(tx, {
          recipientUserId: existing.requestedByUserId,
          kind: "team.request.changes_proposed",
          payload: {
            requestId: existing.id,
            slug: merged.slug,
            roundCount: nextRound,
            proposedByDisplayName: req.user!.displayName,
          },
        });
      } else {
        await audit(
          tx,
          req,
          "team.request.counter_proposed",
          {
            requestId: existing.id,
            slug: merged.slug,
            requestedByUserId: req.user!.id,
            roundCount: nextRound,
          },
          { kind: "teamRequest", id: existing.id },
        );
        const admins = await tx.user.findMany({
          where: { role: "admin" },
          select: { id: true },
        });
        for (const a of admins) {
          await notify(tx, {
            recipientUserId: a.id,
            kind: "team.request.counter_proposed",
            payload: {
              requestId: existing.id,
              slug: merged.slug,
              roundCount: nextRound,
              requestedByDisplayName: existing.requestedBy.displayName,
            },
          });
        }
      }
      return next;
    });
    const userMap = await loadProposedUserMap([updated]);
    res.json(shapeTeamRequest(updated, userMap));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "An open request for this slug already exists" });
      return;
    }
    throw err;
  }
}

teamRequestsRouter.post("/:id/approve", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await runApproval(req, res, req.params.id, { confirmedByRequester: false });
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({ reason: z.string().min(1).max(1000) });

teamRequestsRouter.post("/:id/reject", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const request = await prisma.teamRequest.findUnique({ where: { id: req.params.id } });
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (!isActiveStatus(request.status)) {
      res.status(409).json({ error: `Request is ${request.status}` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.teamRequest.update({
        where: { id: request.id },
        data: {
          status: "rejected",
          reviewedByUserId: req.user!.id,
          reviewedAt: new Date(),
          rejectionReason: parsed.data.reason,
        },
        include: TEAM_REQUEST_INCLUDE,
      });
      await audit(
        tx,
        req,
        "team.request.rejected",
        {
          requestId: request.id,
          reviewedByUserId: req.user!.id,
          reason: parsed.data.reason,
        },
        { kind: "teamRequest", id: request.id },
      );
      await notify(tx, {
        recipientUserId: request.requestedByUserId,
        kind: "team.request.rejected",
        payload: {
          requestId: request.id,
          slug: request.slug,
          reason: parsed.data.reason,
        },
      });
      return next;
    });
    const userMap = await loadProposedUserMap([updated]);
    res.json(shapeTeamRequest(updated, userMap));
  } catch (err) {
    next(err);
  }
});

teamRequestsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const request = await prisma.teamRequest.findUnique({ where: { id: req.params.id } });
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (request.requestedByUserId !== req.user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!isActiveStatus(request.status)) {
      res.status(409).json({ error: `Request is ${request.status}` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.teamRequest.update({
        where: { id: request.id },
        data: { status: "cancelled", reviewedAt: new Date() },
        include: TEAM_REQUEST_INCLUDE,
      });
      await audit(
        tx,
        req,
        "team.request.cancelled",
        {
          requestId: request.id,
          slug: request.slug,
          requestedByUserId: request.requestedByUserId,
        },
        { kind: "teamRequest", id: request.id },
      );
      return next;
    });
    const userMap = await loadProposedUserMap([updated]);
    res.json(shapeTeamRequest(updated, userMap));
  } catch (err) {
    next(err);
  }
});

interface RunApprovalOptions {
  // True when the requester confirmed the admin's proposed values.
  confirmedByRequester: boolean;
}

async function runApproval(
  req: Request,
  res: import("express").Response,
  requestId: string,
  opts: RunApprovalOptions,
): Promise<void> {
  const request = await prisma.teamRequest.findUnique({
    where: { id: requestId },
    include: TEAM_REQUEST_INCLUDE,
  });
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (!isActiveStatus(request.status)) {
    res.status(409).json({ error: `Request is ${request.status}` });
    return;
  }

  let mirror: {
    nodeId: string;
    githubSlug: string;
    orgLogin: string;
    installationId: number;
    maintainerState: "active" | "pending";
  } | null = null;

  if (request.mirrorToGithub) {
    const integration = request.githubIntegration;
    if (!integration || !integration.enabled || integration.kind !== "github") {
      res.status(409).json({
        error: "GitHub integration is missing or disabled; mirror is no longer possible.",
      });
      return;
    }
    const orgLogin = readGithubOrgLogin(integration);
    const installationId = readInstallationId(integration);
    if (!orgLogin || installationId == null) {
      res.status(409).json({
        error: "GitHub integration is missing accountLogin or installationId.",
      });
      return;
    }
    let created: { nodeId: string; githubSlug: string };
    try {
      created = await createGithubTeam({
        installationId,
        orgLogin,
        name: request.name,
        description: request.description,
      });
    } catch (err) {
      const message =
        err instanceof GithubMirrorError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      res.status(502).json({ error: `GitHub team create failed: ${message}` });
      return;
    }

    // GitHub does not auto-add the actor; seat the requester as maintainer so the GH-source-of-truth reconciler does not wipe the platform lead.
    let maintainerState: "active" | "pending";
    try {
      const result = await addGithubTeamMaintainer({
        installationId,
        orgLogin,
        githubSlug: created.githubSlug,
        githubLogin: request.requestedBy.githubLogin,
      });
      maintainerState = result.state;
    } catch (err) {
      // Couldn't seat the requester; roll back the GH team so the request stays approve-able after a fix.
      await bestEffortDeleteGithubTeam(installationId, orgLogin, created.githubSlug);
      const message =
        err instanceof GithubMirrorError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      res.status(502).json({
        error: `GitHub team was created but the requester couldn't be added as maintainer: ${message}. The team has been removed; retry once permissions are sorted.`,
      });
      return;
    }

    mirror = { ...created, orgLogin, installationId, maintainerState };
  }

  const reviewerUserId = opts.confirmedByRequester
    ? (request.lastEditedByUserId ?? req.user!.id)
    : req.user!.id;

  // Pre-staged maintainers/members: for mirrored teams push to GH first (source-of-truth) and only then seat platform-side.
  // Per-user failures become partialFailures and do not roll back the approval.
  const dedupedProposedIds = Array.from(
    new Set([...request.proposedMaintainerUserIds, ...request.proposedMemberUserIds]),
  ).filter((id) => id !== request.requestedByUserId);
  const proposedMaintainerSet = new Set(request.proposedMaintainerUserIds);

  interface UserToSeed {
    userId: string;
    role: "lead" | "member";
    displayName: string;
  }
  const usersToSeed: UserToSeed[] = [];
  const partialFailures: Array<{ userId: string; displayName: string; reason: string }> = [];

  if (dedupedProposedIds.length > 0) {
    const proposedUsers = await prisma.user.findMany({
      where: { id: { in: dedupedProposedIds } },
      select: { id: true, displayName: true, githubLogin: true },
    });
    const proposedMap = new Map(proposedUsers.map((u) => [u.id, u]));

    for (const id of dedupedProposedIds) {
      const u = proposedMap.get(id);
      if (!u) {
        partialFailures.push({
          userId: id,
          displayName: "(unknown user)",
          reason: "User no longer exists",
        });
        continue;
      }
      const role: "lead" | "member" = proposedMaintainerSet.has(id) ? "lead" : "member";

      if (mirror) {
        try {
          await addGithubTeamMember({
            installationId: mirror.installationId,
            orgLogin: mirror.orgLogin,
            githubSlug: mirror.githubSlug,
            githubLogin: u.githubLogin,
            role: role === "lead" ? "maintainer" : "member",
          });
        } catch (err) {
          const message =
            err instanceof GithubMirrorError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Unknown GitHub error";
          partialFailures.push({ userId: id, displayName: u.displayName, reason: message });
          continue;
        }
      }
      usersToSeed.push({ userId: id, role, displayName: u.displayName });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Mirrored teams upsert by (source, externalId) since the reconciler webhook may have raced us.
      // Org binding: mirror uses the GH org; non-mirror falls back to the requester's first UserOrgMembership, else abort.
      let accountLogin: string;
      if (mirror) {
        accountLogin = mirror.orgLogin;
      } else {
        const firstMembership = await tx.userOrgMembership.findFirst({
          where: { userId: request.requestedByUserId },
          select: { accountLogin: true },
        });
        if (!firstMembership) {
          throw new Error(
            "Cannot approve a non-mirror team request whose requester has no UserOrgMembership row",
          );
        }
        accountLogin = firstMembership.accountLogin;
      }

      const team = mirror
        ? await tx.team.upsert({
            where: {
              source_externalId: { source: "github", externalId: mirror.nodeId },
            },
            create: {
              slug: request.slug,
              name: request.name,
              description: request.description,
              accountLogin,
              source: "github",
              externalId: mirror.nodeId,
              externalSlug: mirror.githubSlug,
              installationId: mirror.installationId,
              lastSyncedAt: new Date(),
            },
            update: {
              slug: request.slug,
              name: request.name,
              description: request.description,
              externalSlug: mirror.githubSlug,
              installationId: mirror.installationId,
              lastSyncedAt: new Date(),
              deletedAt: null,
            },
          })
        : await tx.team.create({
            data: {
              slug: request.slug,
              name: request.name,
              description: request.description,
              accountLogin,
              source: "manual",
            },
          });
      // Upsert the lead membership; the membership webhook may have raced and inserted it already.
      await tx.teamMembership.upsert({
        where: {
          teamId_userId: { teamId: team.id, userId: request.requestedByUserId },
        },
        create: { teamId: team.id, userId: request.requestedByUserId, role: "lead" },
        update: { role: "lead" },
      });
      // Seat pre-staged users; partialFailures were filtered out so we never write rows the reconciler would wipe.
      for (const u of usersToSeed) {
        await tx.teamMembership.upsert({
          where: { teamId_userId: { teamId: team.id, userId: u.userId } },
          create: { teamId: team.id, userId: u.userId, role: u.role },
          update: { role: u.role },
        });
        await audit(
          tx,
          req,
          "team.member.added",
          { teamId: team.id, userId: u.userId, role: u.role },
          { kind: "team", id: team.id },
        );
        await notify(tx, {
          recipientUserId: u.userId,
          kind: "team.member.added",
          payload: { teamId: team.id, teamSlug: team.slug, role: u.role },
          teamId: team.id,
        });
      }
      const updated = await tx.teamRequest.update({
        where: { id: request.id },
        data: {
          status: "approved",
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          createdTeamId: team.id,
        },
        include: TEAM_REQUEST_INCLUDE,
      });
      await audit(
        tx,
        req,
        "team.request.approved",
        {
          requestId: request.id,
          teamId: team.id,
          reviewedByUserId: reviewerUserId,
          mirroredToGithub: !!mirror,
        },
        { kind: "teamRequest", id: request.id },
      );
      await audit(
        tx,
        req,
        "team.created",
        { teamId: team.id, slug: team.slug, viaRequestId: request.id },
        { kind: "team", id: team.id },
      );
      if (opts.confirmedByRequester) {
        await audit(
          tx,
          req,
          "team.request.proposal_confirmed",
          { requestId: request.id, teamId: team.id },
          { kind: "teamRequest", id: request.id },
        );
      }
      await notify(tx, {
        recipientUserId: request.requestedByUserId,
        kind: "team.request.approved",
        payload: {
          requestId: request.id,
          teamId: team.id,
          slug: team.slug,
          mirroredToGithub: !!mirror,
          githubOrgLogin: mirror?.orgLogin ?? null,
          // "pending" means the requester has an unaccepted GitHub org invite and won't see the team yet.
          githubMaintainerState: mirror?.maintainerState ?? null,
          changedFromOriginal: summarizeDiff(request),
        },
        teamId: team.id,
      });
      return updated;
    });
    const userMap = await loadProposedUserMap([result]);
    const dto = shapeTeamRequest(result, userMap);
    res.json({ ...dto, partialFailures: partialFailures.length > 0 ? partialFailures : undefined });
  } catch (err) {
    // Platform write failed after GH team-create; clean up the orphan so a retry isn't blocked.
    if (mirror) {
      await bestEffortDeleteGithubTeam(mirror.installationId, mirror.orgLogin, mirror.githubSlug);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    throw err;
  }
}

function isActiveStatus(s: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(s);
}

function readInstallationId(integration: Prisma.IntegrationGetPayload<true>): number | null {
  const cfg = integration.config;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const raw = (cfg as Record<string, unknown>).installationId;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

async function validateGithubIntegration(
  integrationId: string,
  res: import("express").Response,
): Promise<boolean> {
  const integ = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, kind: true, enabled: true },
  });
  if (!integ || integ.kind !== "github" || !integ.enabled) {
    res.status(400).json({
      error: "githubIntegrationId must reference an enabled GitHub integration",
    });
    return false;
  }
  return true;
}

async function fanoutAdminSubmitted(
  tx: Prisma.TransactionClient,
  request: TeamRequestRow,
): Promise<void> {
  const admins = await tx.user.findMany({
    where: { role: "admin" },
    select: { id: true },
  });
  for (const admin of admins) {
    await notify(tx, {
      recipientUserId: admin.id,
      kind: "team.request.submitted",
      payload: {
        requestId: request.id,
        slug: request.slug,
        name: request.name,
        requestedByUserId: request.requestedByUserId,
        requestedByDisplayName: request.requestedBy.displayName,
        mirrorToGithub: request.mirrorToGithub,
      },
    });
  }
}

interface DiffSummary {
  slugChanged: boolean;
  nameChanged: boolean;
  descriptionChanged: boolean;
  mirrorToGithubChanged: boolean;
  githubIntegrationChanged: boolean;
}

function summarizeDiff(r: TeamRequestRow): DiffSummary {
  return {
    slugChanged: r.slug !== r.originalSlug,
    nameChanged: r.name !== r.originalName,
    descriptionChanged: (r.description ?? null) !== (r.originalDescription ?? null),
    mirrorToGithubChanged: r.mirrorToGithub !== r.originalMirrorToGithub,
    githubIntegrationChanged:
      (r.githubIntegrationId ?? null) !== (r.originalGithubIntegrationId ?? null),
  };
}
