import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import {
  actorFromRequest,
  filterByTemplateAcl,
  getTemplateRegistry,
} from "@feature/scaffolder-backend";
import { recordAudit } from "../audit/audit";

export const scaffolderAccessRequestsRouter = Router();

const submitSchema = z.object({
  templateId: z.string().min(1),
  permission: z.enum(["view", "execute"]),
  reason: z.string().max(2000).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
});

function shape(r: {
  id: string;
  templateId: string;
  requestedByUserId: string;
  permission: "view" | "execute";
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAclId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    templateId: r.templateId,
    requestedByUserId: r.requestedByUserId,
    permission: r.permission,
    reason: r.reason,
    status: r.status,
    reviewedByUserId: r.reviewedByUserId,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    rejectionReason: r.rejectionReason,
    createdAclId: r.createdAclId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

scaffolderAccessRequestsRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const tpl = getTemplateRegistry().get(parsed.data.templateId);
    if (!tpl) return res.status(404).json({ error: "Template not found" });

    const actor = await actorFromRequest(req);
    if (!actor) return res.status(401).json({ error: "Not authenticated" });

    const isAdmin = req.user.role === "admin";
    const checkExecute = parsed.data.permission === "execute";
    const already = await filterByTemplateAcl([tpl], actor, isAdmin, checkExecute);
    if (already.length > 0) {
      return res.status(409).json({
        error: `You already have ${parsed.data.permission} access to this template`,
      });
    }

    const dup = await prisma.templateAccessRequest.findFirst({
      where: {
        templateId: parsed.data.templateId,
        requestedByUserId: req.user.id,
        permission: parsed.data.permission,
        status: "pending",
      },
    });
    if (dup) {
      return res.status(409).json({
        error: "You already have a pending request for this permission",
        requestId: dup.id,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const reqRow = await tx.templateAccessRequest.create({
        data: {
          templateId: parsed.data.templateId,
          requestedByUserId: req.user!.id,
          permission: parsed.data.permission,
          reason: parsed.data.reason ?? null,
        },
      });

      const admins = await tx.user.findMany({
        where: { role: "admin" },
        select: { id: true },
      });
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            recipientUserId: a.id,
            kind: "template_access_request.submitted",
            payload: {
              requestId: reqRow.id,
              templateId: reqRow.templateId,
              requestedByUserId: reqRow.requestedByUserId,
              permission: reqRow.permission,
            } as Prisma.InputJsonValue,
          })),
        });
      }

      return reqRow;
    });

    await recordAudit(
      req,
      "template_access_request.submitted",
      {
        requestId: created.id,
        templateId: created.templateId,
        requestedByUserId: created.requestedByUserId,
        permission: created.permission,
      },
      { kind: "templateAccessRequest", id: created.id },
    );

    res.status(201).json(shape(created));
  } catch (err) {
    next(err);
  }
});

scaffolderAccessRequestsRouter.get("/mine", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const rows = await prisma.templateAccessRequest.findMany({
      where: {
        requestedByUserId: req.user.id,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

scaffolderAccessRequestsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const id = String(req.params.id);
    const row = await prisma.templateAccessRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (req.user.role !== "admin" && row.requestedByUserId !== req.user.id) {
      return res.status(404).json({ error: "Request not found" });
    }
    res.json(shape(row));
  } catch (err) {
    next(err);
  }
});

scaffolderAccessRequestsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const id = String(req.params.id);
    const row = await prisma.templateAccessRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.requestedByUserId !== req.user.id) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (row.status !== "pending") {
      return res.status(409).json({ error: `Request is ${row.status}` });
    }

    const updated = await prisma.templateAccessRequest.update({
      where: { id: row.id },
      data: { status: "cancelled" },
    });

    await recordAudit(
      req,
      "template_access_request.cancelled",
      { requestId: row.id, requestedByUserId: row.requestedByUserId },
      { kind: "templateAccessRequest", id: row.id },
    );

    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});
