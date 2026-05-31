// Pages API: CRUD, move, and layout for the per-section navigable page tree.
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import type { Page, PageType as PrismaPageType, PageScope as PrismaPageScope } from "@internal/db";
import type {
  PageDto,
  PageScope,
  PageSection,
  PageType,
  PageWidgetInstance,
} from "@internal/shared-types";

export const pagesRouter: Router = Router();

const ORDER_STEP = 1024;

type AuditKind =
  | "page.created"
  | "page.updated"
  | "page.moved"
  | "page.deleted"
  | "page.layout.updated";

async function audit(
  req: Request,
  kind: AuditKind,
  payload: Record<string, unknown>,
  target: { kind: string; id: string },
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: req.user?.id ?? null,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
        kind,
        targetKind: target.kind,
        targetId: target.id,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Audit is best-effort; never fail the user request on audit errors.
  }
}

const SECTIONS: ReadonlyArray<PageSection> = [
  "catalog",
  "selfservice",
  "requests",
  "workspace",
  "teams",
  "observability",
  "admin",
  "agents",
];
const sectionSchema = z.enum(SECTIONS as [PageSection, ...PageSection[]]);
const scopeSchema = z.enum(["PERSONAL", "SHARED"]);
const typeSchema = z.enum(["LINK", "DASHBOARD"]);

function toDto(p: Page): PageDto {
  return {
    id: p.id,
    ownerUserId: p.ownerUserId,
    section: p.section as PageSection,
    parentId: p.parentId,
    title: p.title,
    icon: p.icon,
    url: p.url,
    order: p.order,
    isFolder: p.isFolder,
    type: p.type as PageType,
    scope: p.scope as PageScope,
    layout: (p.layout as PageWidgetInstance[] | null) ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function isAdminSectionAllowed(role: string, section: PageSection): boolean {
  if (section !== "admin") return true;
  return role === "admin";
}

function canEdit(
  page: Pick<Page, "ownerUserId" | "scope">,
  user: { id: string; role: string },
): boolean {
  if (page.scope === "SHARED") return user.role === "admin";
  return page.ownerUserId === user.id;
}

function canRead(page: Pick<Page, "ownerUserId" | "scope">, user: { id: string }): boolean {
  if (page.scope === "SHARED") return true;
  return page.ownerUserId === user.id;
}

pagesRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = sectionSchema.safeParse(req.query.section);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid section" });
      return;
    }
    const section = parsed.data;
    if (!isAdminSectionAllowed(req.user.role, section)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const userId = req.user.id;
    const items = await prisma.page.findMany({
      where: {
        section,
        deletedAt: null,
        OR: [{ scope: "SHARED" }, { ownerUserId: userId }],
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    res.json({ items: items.map(toDto) });
  } catch (err) {
    next(err);
  }
});

pagesRouter.get("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const page = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!page || !canRead(page, req.user)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json(toDto(page));
  } catch (err) {
    next(err);
  }
});

const createSchema = z
  .object({
    section: sectionSchema,
    parentId: z.string().min(1).nullable().optional(),
    title: z.string().min(1).max(120),
    icon: z.string().max(64).nullable().optional(),
    url: z.string().min(1).max(500).optional(),
    isFolder: z.boolean().optional(),
    type: typeSchema.optional(),
    scope: scopeSchema.optional(),
    afterId: z.string().min(1).optional(),
  })
  .refine(
    (v) => {
      const t = v.type ?? "LINK";
      if (t === "LINK" && !v.isFolder) {
        return typeof v.url === "string" && v.url.length > 0;
      }
      return true;
    },
    { message: "url is required for LINK pages", path: ["url"] },
  );

pagesRouter.post("/", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { section, parentId, title, icon, isFolder, afterId } = parsed.data;
    if (!isAdminSectionAllowed(req.user.role, section)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const userId = req.user.id;
    const isAdmin = req.user.role === "admin";
    const folder = isFolder ?? false;
    const type: PageType = parsed.data.type ?? "LINK";
    // Non-admins are forced to personal scope regardless of requested scope.
    const scope: PageScope = !isAdmin ? "PERSONAL" : (parsed.data.scope ?? "SHARED");

    const url = type === "DASHBOARD" || folder ? null : (parsed.data.url as string);

    if (parentId) {
      const parent = await prisma.page.findFirst({
        where: { id: parentId, section, deletedAt: null },
        select: { id: true, isFolder: true, scope: true, ownerUserId: true },
      });
      if (!parent || !canRead(parent, req.user)) {
        res.status(400).json({ error: "Parent not found" });
        return;
      }
      if (!parent.isFolder) {
        res.status(400).json({ error: "Parent is not a folder" });
        return;
      }
      if (parent.scope !== scope) {
        res.status(400).json({ error: "Parent scope does not match" });
        return;
      }
    }

    const order = await computeInsertOrder(
      userId,
      section,
      parentId ?? null,
      scope,
      afterId ?? null,
    );

    const created = await prisma.page.create({
      data: {
        ownerUserId: userId,
        section,
        parentId: parentId ?? null,
        title,
        icon: icon ?? null,
        url,
        order,
        isFolder: folder,
        type: type as PrismaPageType,
        scope: scope as PrismaPageScope,
        layout: type === "DASHBOARD" ? ([] as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    await audit(
      req,
      "page.created",
      {
        pageId: created.id,
        section: created.section,
        parentId: created.parentId,
        isFolder: created.isFolder,
        type: created.type,
        scope: created.scope,
      },
      { kind: "Page", id: created.id },
    );

    res.status(201).json(toDto(created));
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  icon: z.string().max(64).nullable().optional(),
  url: z.string().min(1).max(500).nullable().optional(),
});

pagesRouter.patch("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing || !canRead(existing, req.user)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    if (!canEdit(existing, req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const data: Prisma.PageUpdateInput = {};
    const fields: string[] = [];
    if (parsed.data.title !== undefined) {
      data.title = parsed.data.title;
      fields.push("title");
    }
    if (parsed.data.icon !== undefined) {
      data.icon = parsed.data.icon;
      fields.push("icon");
    }
    if (parsed.data.url !== undefined) {
      if (existing.type === "LINK" && (parsed.data.url === null || parsed.data.url === "")) {
        res.status(400).json({ error: "url is required for LINK pages" });
        return;
      }
      if (existing.type === "DASHBOARD" && parsed.data.url !== null) {
        res.status(400).json({ error: "DASHBOARD pages cannot have a url" });
        return;
      }
      data.url = parsed.data.url;
      fields.push("url");
    }
    const updated = await prisma.page.update({
      where: { id: existing.id },
      data,
    });
    if (fields.length > 0) {
      await audit(
        req,
        "page.updated",
        { pageId: updated.id, fields },
        { kind: "Page", id: updated.id },
      );
    }
    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});

const widgetInstanceSchema = z.object({
  i: z.string().min(1).max(80),
  widgetId: z.string().min(1).max(64),
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(100),
  config: z.record(z.string(), z.unknown()).optional(),
});

const layoutSchema = z.object({
  layout: z.array(widgetInstanceSchema).max(100),
});

pagesRouter.patch("/:id/layout", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = layoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing || !canRead(existing, req.user)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    if (existing.type !== "DASHBOARD") {
      res.status(400).json({ error: "Layout only applies to DASHBOARD pages" });
      return;
    }
    if (!canEdit(existing, req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const updated = await prisma.page.update({
      where: { id: existing.id },
      data: { layout: parsed.data.layout as unknown as Prisma.InputJsonValue },
    });
    await audit(
      req,
      "page.layout.updated",
      { pageId: updated.id, widgetCount: parsed.data.layout.length },
      { kind: "Page", id: updated.id },
    );
    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});

const moveSchema = z
  .object({
    parentId: z.string().min(1).nullable().optional(),
    afterId: z.string().min(1).optional(),
    beforeId: z.string().min(1).optional(),
  })
  .refine((v) => !(v.afterId && v.beforeId), {
    message: "afterId and beforeId are mutually exclusive",
  });

pagesRouter.post("/:id/move", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const target = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!target || !canRead(target, req.user)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    if (!canEdit(target, req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const newParentId = parsed.data.parentId === undefined ? target.parentId : parsed.data.parentId;
    if (newParentId) {
      // Cycle check: new parent must not be the page itself or a descendant.
      if (newParentId === target.id) {
        res.status(400).json({ error: "Cannot move a page into itself" });
        return;
      }
      const parent = await prisma.page.findFirst({
        where: {
          id: newParentId,
          section: target.section,
          deletedAt: null,
        },
        select: { id: true, parentId: true, isFolder: true, scope: true, ownerUserId: true },
      });
      if (!parent || !canRead(parent, req.user)) {
        res.status(400).json({ error: "Parent not found" });
        return;
      }
      if (!parent.isFolder) {
        res.status(400).json({ error: "Parent is not a folder" });
        return;
      }
      if (parent.scope !== target.scope) {
        res.status(400).json({ error: "Parent scope does not match" });
        return;
      }
      let cursor: { id: string; parentId: string | null } | null = parent;
      while (cursor && cursor.parentId) {
        if (cursor.parentId === target.id) {
          res.status(400).json({ error: "Cannot move a page into its own descendant" });
          return;
        }
        cursor = await prisma.page.findUnique({
          where: { id: cursor.parentId },
          select: { id: true, parentId: true },
        });
      }
    }

    const order = await computeMoveOrder(
      target.section as PageSection,
      newParentId ?? null,
      target.scope as PageScope,
      target.ownerUserId,
      target.id,
      parsed.data.afterId ?? null,
      parsed.data.beforeId ?? null,
    );

    const updated = await prisma.page.update({
      where: { id: target.id },
      data: { parentId: newParentId ?? null, order },
    });

    await audit(
      req,
      "page.moved",
      {
        pageId: updated.id,
        fromParentId: target.parentId,
        toParentId: updated.parentId,
      },
      { kind: "Page", id: updated.id },
    );

    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});

pagesRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const target = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!target || !canRead(target, req.user)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    if (!canEdit(target, req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const now = new Date();
    // Soft-delete cascades to every descendant.
    const ids = await collectDescendantIds(target.id);
    await prisma.page.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: now },
    });
    await audit(
      req,
      "page.deleted",
      { pageId: target.id, section: target.section },
      { kind: "Page", id: target.id },
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Order is computed within a (section, parentId, scope) bucket. */
async function siblingFilter(
  ownerUserId: string,
  section: PageSection,
  parentId: string | null,
  scope: PageScope,
): Promise<Prisma.PageWhereInput> {
  const base: Prisma.PageWhereInput = { section, parentId, scope, deletedAt: null };
  if (scope === "PERSONAL") return { ...base, ownerUserId };
  return base;
}

async function computeInsertOrder(
  ownerUserId: string,
  section: PageSection,
  parentId: string | null,
  scope: PageScope,
  afterId: string | null,
): Promise<number> {
  const where = await siblingFilter(ownerUserId, section, parentId, scope);
  const siblings = await prisma.page.findMany({
    where,
    orderBy: [{ order: "asc" }],
    select: { id: true, order: true },
  });
  if (siblings.length === 0) return ORDER_STEP;
  if (!afterId) {
    const last = siblings[siblings.length - 1]!;
    return last.order + ORDER_STEP;
  }
  const idx = siblings.findIndex((s) => s.id === afterId);
  if (idx === -1) {
    const last = siblings[siblings.length - 1]!;
    return last.order + ORDER_STEP;
  }
  const before = siblings[idx]!;
  const after = siblings[idx + 1];
  if (!after) return before.order + ORDER_STEP;
  return (before.order + after.order) / 2;
}

async function computeMoveOrder(
  section: PageSection,
  parentId: string | null,
  scope: PageScope,
  ownerUserId: string,
  selfId: string,
  afterId: string | null,
  beforeId: string | null,
): Promise<number> {
  const where = await siblingFilter(ownerUserId, section, parentId, scope);
  const siblings = (
    await prisma.page.findMany({
      where,
      orderBy: [{ order: "asc" }],
      select: { id: true, order: true },
    })
  ).filter((s) => s.id !== selfId);
  if (siblings.length === 0) return ORDER_STEP;
  if (afterId) {
    const idx = siblings.findIndex((s) => s.id === afterId);
    if (idx === -1) return siblings[siblings.length - 1]!.order + ORDER_STEP;
    const before = siblings[idx]!;
    const after = siblings[idx + 1];
    if (!after) return before.order + ORDER_STEP;
    return (before.order + after.order) / 2;
  }
  if (beforeId) {
    const idx = siblings.findIndex((s) => s.id === beforeId);
    if (idx === -1) return siblings[0]!.order - ORDER_STEP;
    const after = siblings[idx]!;
    const before = idx > 0 ? siblings[idx - 1] : null;
    if (!before) return after.order - ORDER_STEP;
    return (before.order + after.order) / 2;
  }
  return siblings[siblings.length - 1]!.order + ORDER_STEP;
}

async function collectDescendantIds(rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  let frontier: string[] = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.page.findMany({
      where: {
        parentId: { in: frontier },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (children.length === 0) break;
    const next = children.map((c) => c.id);
    ids.push(...next);
    frontier = next;
  }
  return ids;
}
