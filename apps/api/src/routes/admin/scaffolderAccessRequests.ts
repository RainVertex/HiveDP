// Admin routes to list, approve, and reject scaffolder template access requests, granting ACLs and notifying requesters.
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";
import { recordAudit } from "../../audit/audit";

export const adminScaffolderAccessRequestsRouter = Router();

adminScaffolderAccessRequestsRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const listQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
});

const rejectSchema = z.object({ reason: z.string().min(1).max(2000) });

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

adminScaffolderAccessRequestsRouter.get("/", async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const rows = await prisma.templateAccessRequest.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : {},
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

adminScaffolderAccessRequestsRouter.get("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const row = await prisma.templateAccessRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    res.json(shape(row));
  } catch (err) {
    next(err);
  }
});

adminScaffolderAccessRequestsRouter.post("/:id/approve", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const row = await prisma.templateAccessRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.status !== "pending")
      return res.status(409).json({ error: `Request is ${row.status}` });

    const canView = true;
    const canExecute = row.permission === "execute";

    const result = await prisma.$transaction(async (tx) => {
      const acl = await tx.templateAcl.upsert({
        where: {
          templateId_subjectType_subjectId: {
            templateId: row.templateId,
            subjectType: "user",
            subjectId: row.requestedByUserId,
          },
        },
        create: {
          templateId: row.templateId,
          subjectType: "user",
          subjectId: row.requestedByUserId,
          canView,
          canExecute,
        },
        update: {
          // Upgrade only, don't downgrade an existing grant
          canView: true,
          canExecute: canExecute || undefined,
        },
      });

      const updated = await tx.templateAccessRequest.update({
        where: { id: row.id },
        data: {
          status: "approved",
          reviewedByUserId: req.user!.id,
          reviewedAt: new Date(),
          createdAclId: acl.id,
        },
      });

      await tx.notification.create({
        data: {
          recipientUserId: row.requestedByUserId,
          kind: "template_access_request.approved",
          payload: {
            requestId: row.id,
            templateId: row.templateId,
            permission: row.permission,
            aclId: acl.id,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        updated,
        aclId: acl.id,
        aclSubject: acl.subjectType,
        aclCanView: acl.canView,
        aclCanExecute: acl.canExecute,
      };
    });

    await recordAudit(
      req,
      "template_access_request.approved",
      {
        requestId: row.id,
        templateId: row.templateId,
        reviewedByUserId: req.user!.id,
        aclId: result.aclId,
      },
      { kind: "templateAccessRequest", id: row.id },
    );
    await recordAudit(
      req,
      "template_acl.created",
      {
        templateId: row.templateId,
        aclId: result.aclId,
        subjectType: "user",
        subjectId: row.requestedByUserId,
        canView: result.aclCanView,
        canExecute: result.aclCanExecute,
      },
      { kind: "templateAcl", id: result.aclId },
    );

    res.json(shape(result.updated));
  } catch (err) {
    next(err);
  }
});

adminScaffolderAccessRequestsRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const row = await prisma.templateAccessRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.status !== "pending")
      return res.status(409).json({ error: `Request is ${row.status}` });

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.templateAccessRequest.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          reviewedByUserId: req.user!.id,
          reviewedAt: new Date(),
          rejectionReason: parsed.data.reason,
        },
      });
      await tx.notification.create({
        data: {
          recipientUserId: row.requestedByUserId,
          kind: "template_access_request.rejected",
          payload: {
            requestId: row.id,
            templateId: row.templateId,
            reason: parsed.data.reason,
          } as Prisma.InputJsonValue,
        },
      });
      return r;
    });

    await recordAudit(
      req,
      "template_access_request.rejected",
      { requestId: row.id, reviewedByUserId: req.user!.id, reason: parsed.data.reason },
      { kind: "templateAccessRequest", id: row.id },
    );

    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});
