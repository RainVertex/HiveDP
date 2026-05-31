// Admin API for per-template scaffolder ACL rows (view/execute by user/team/everyone).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import { EVERYONE_SUBJECT_ID, getTemplateRegistry } from "@feature/scaffolder-backend";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";
import { recordAudit } from "../../audit/audit";

export const adminScaffolderTemplateAclsRouter = Router();

adminScaffolderTemplateAclsRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const upsertSchema = z.object({
  subjectType: z.enum(["user", "team", "everyone"]),
  subjectId: z.string().min(1).optional(),
  canView: z.boolean().optional(),
  canExecute: z.boolean().optional(),
});

function shape(r: {
  id: string;
  templateId: string;
  subjectType: "user" | "team" | "everyone";
  subjectId: string;
  canView: boolean;
  canExecute: boolean;
  createdAt: Date;
}) {
  return {
    id: r.id,
    templateId: r.templateId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    canView: r.canView,
    canExecute: r.canExecute,
    createdAt: r.createdAt.toISOString(),
  };
}

function templateExists(templateId: string): boolean {
  return getTemplateRegistry().get(templateId) !== undefined;
}

adminScaffolderTemplateAclsRouter.get("/:id/acl", async (req, res, next) => {
  try {
    const templateId = String(req.params.id);
    if (!templateExists(templateId)) return res.status(404).json({ error: "Template not found" });
    const rows = await prisma.templateAcl.findMany({
      where: { templateId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items: rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

adminScaffolderTemplateAclsRouter.post("/:id/acl", async (req, res, next) => {
  try {
    const templateId = String(req.params.id);
    if (!templateExists(templateId)) return res.status(404).json({ error: "Template not found" });

    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    let subjectId: string;
    if (parsed.data.subjectType === "everyone") {
      subjectId = EVERYONE_SUBJECT_ID;
    } else {
      if (!parsed.data.subjectId) {
        return res.status(400).json({ error: "subjectId required for user/team subjects" });
      }
      subjectId = parsed.data.subjectId;

      if (parsed.data.subjectType === "user") {
        const u = await prisma.user.findUnique({ where: { id: subjectId } });
        if (!u) return res.status(404).json({ error: "User not found" });
      } else {
        const t = await prisma.team.findFirst({ where: { id: subjectId, deletedAt: null } });
        if (!t) return res.status(404).json({ error: "Team not found" });
      }
    }

    const canView = parsed.data.canView ?? true;
    const canExecute = parsed.data.canExecute ?? false;

    const existing = await prisma.templateAcl.findUnique({
      where: {
        templateId_subjectType_subjectId: {
          templateId,
          subjectType: parsed.data.subjectType,
          subjectId,
        },
      },
    });

    const row = await prisma.templateAcl.upsert({
      where: {
        templateId_subjectType_subjectId: {
          templateId,
          subjectType: parsed.data.subjectType,
          subjectId,
        },
      },
      create: {
        templateId,
        subjectType: parsed.data.subjectType,
        subjectId,
        canView,
        canExecute,
      },
      update: { canView, canExecute },
    });

    await recordAudit(
      req,
      existing ? "template_acl.updated" : "template_acl.created",
      {
        templateId,
        aclId: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        canView: row.canView,
        canExecute: row.canExecute,
      },
      { kind: "templateAcl", id: row.id },
    );

    res.status(existing ? 200 : 201).json(shape(row));
  } catch (err) {
    next(err);
  }
});

adminScaffolderTemplateAclsRouter.delete("/:id/acl/:rowId", async (req, res, next) => {
  try {
    const templateId = String(req.params.id);
    const rowId = String(req.params.rowId);
    const row = await prisma.templateAcl.findUnique({ where: { id: rowId } });
    if (!row || row.templateId !== templateId) {
      return res.status(404).json({ error: "ACL row not found" });
    }
    await prisma.templateAcl.delete({ where: { id: rowId } });
    await recordAudit(
      req,
      "template_acl.deleted",
      { templateId, aclId: rowId, subjectType: row.subjectType, subjectId: row.subjectId },
      { kind: "templateAcl", id: rowId },
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
