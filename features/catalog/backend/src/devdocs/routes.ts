// Express routes for devdocs: pages, sync, verification, comments, stale reports, and search.
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import type {
  DocCommentRow,
  DocPageDetail,
  DocPageSummary,
  DocResolvedSource,
  DocStaleReportRow,
  DocSyncStateRow,
  DocsTabResponse,
  DocSyncStatus,
} from "@internal/shared-types";
import { computeFreshness } from "./freshness";
import { syncDevDocsForEntity } from "./sync";
import { getDevDocsHits } from "./search";

const userProjection = {
  id: true,
  displayName: true,
  githubLogin: true,
  avatarUrl: true,
} as const;

function shapePageSummary(row: {
  id: string;
  entityId: string;
  slug: string;
  path: string;
  title: string;
  lastCommitAt: Date | null;
  lastCommitBy: string | null;
  verifiedAt: Date | null;
}): DocPageSummary {
  return {
    id: row.id,
    entityId: row.entityId,
    slug: row.slug,
    path: row.path,
    title: row.title,
    lastCommitAt: row.lastCommitAt ? row.lastCommitAt.toISOString() : null,
    lastCommitBy: row.lastCommitBy,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    freshness: computeFreshness({
      lastCommitAt: row.lastCommitAt,
      verifiedAt: row.verifiedAt,
    }),
  };
}

function shapeSyncState(
  entityId: string,
  row: {
    status: DocSyncStatus;
    lastSyncedAt: Date | null;
    lastError: string | null;
    pageCount: number;
    resolvedSource: Prisma.JsonValue | null;
  } | null,
): DocSyncStateRow {
  if (!row) {
    return {
      entityId,
      status: "ok",
      lastSyncedAt: null,
      lastError: null,
      pageCount: 0,
      resolvedSource: null,
    };
  }
  return {
    entityId,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    pageCount: row.pageCount,
    resolvedSource: (row.resolvedSource as DocResolvedSource | null) ?? null,
  };
}

// Routes scoped to a specific catalog entity.
export const devdocsEntityRouter: Router = Router({ mergeParams: true });

devdocsEntityRouter.get("/", async (req, res) => {
  const entityId = (req.params as Record<string, string>).id;
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: { id: true },
  });
  if (!entity) return res.status(404).json({ error: "Catalog entity not found" });

  const [pages, sync] = await Promise.all([
    prisma.docPage.findMany({
      where: { entityId },
      orderBy: [{ slug: "asc" }],
      select: {
        id: true,
        entityId: true,
        slug: true,
        path: true,
        title: true,
        lastCommitAt: true,
        lastCommitBy: true,
        verifiedAt: true,
      },
    }),
    prisma.docSyncState.findUnique({ where: { entityId } }),
  ]);
  const body: DocsTabResponse = {
    syncState: shapeSyncState(entityId, sync),
    pages: pages.map(shapePageSummary),
  };
  res.json(body);
});

devdocsEntityRouter.post("/sync", async (req, res) => {
  const entityId = (req.params as Record<string, string>).id;
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: { id: true },
  });
  if (!entity) return res.status(404).json({ error: "Catalog entity not found" });
  const result = await syncDevDocsForEntity(entityId);
  res.json(result);
});

devdocsEntityRouter.get("/:slug", async (req, res) => {
  const entityId = (req.params as Record<string, string>).id;
  const slug = req.params.slug;
  const page = await prisma.docPage.findUnique({
    where: { entityId_slug: { entityId, slug } },
  });
  if (!page) return res.status(404).json({ error: "Doc page not found" });

  const [commentCount, openStaleReports] = await Promise.all([
    prisma.docComment.count({ where: { pageId: page.id } }),
    prisma.docStaleReport.count({ where: { pageId: page.id, resolvedAt: null } }),
  ]);

  const summary = shapePageSummary(page);
  const detail: DocPageDetail = {
    ...summary,
    body: page.body,
    frontmatter: (page.frontmatter as Record<string, unknown> | null) ?? null,
    sourceRef: page.sourceRef,
    lastCommitSha: page.lastCommitSha,
    verifiedBy: page.verifiedBy,
    commentCount,
    openStaleReports,
  };
  res.json(detail);
});

// Standalone routes not scoped to an entity.
export const devdocsRouter: Router = Router();

const verifyParam = z.object({ pageId: z.string().min(1) });

devdocsRouter.post("/pages/:pageId/verify", async (req, res) => {
  const params = verifyParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: params.error.message });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const page = await prisma.docPage.findUnique({
    where: { id: params.data.pageId },
    select: { id: true },
  });
  if (!page) return res.status(404).json({ error: "Doc page not found" });

  const updated = await prisma.docPage.update({
    where: { id: page.id },
    data: { verifiedAt: new Date(), verifiedBy: req.user.id },
  });
  res.json({
    pageId: updated.id,
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    verifiedBy: updated.verifiedBy,
  });
});

const commentBody = z.object({
  body: z.string().min(1).max(4000),
  anchor: z.string().max(200).optional(),
});

devdocsRouter.get("/pages/:pageId/comments", async (req, res) => {
  const page = await prisma.docPage.findUnique({
    where: { id: req.params.pageId },
    select: { id: true },
  });
  if (!page) return res.status(404).json({ error: "Doc page not found" });

  const rows = await prisma.docComment.findMany({
    where: { pageId: page.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: userProjection } },
  });
  const items: DocCommentRow[] = rows.map((c) => ({
    id: c.id,
    pageId: c.pageId,
    body: c.body,
    anchor: c.anchor,
    createdAt: c.createdAt.toISOString(),
    author: c.author
      ? {
          id: c.author.id,
          displayName: c.author.displayName,
          githubLogin: c.author.githubLogin,
          avatarUrl: c.author.avatarUrl,
        }
      : null,
  }));
  res.json({ items });
});

devdocsRouter.post("/pages/:pageId/comments", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const parsed = commentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const page = await prisma.docPage.findUnique({
    where: { id: req.params.pageId },
    select: { id: true },
  });
  if (!page) return res.status(404).json({ error: "Doc page not found" });

  const created = await prisma.docComment.create({
    data: {
      pageId: page.id,
      authorId: req.user.id,
      body: parsed.data.body,
      anchor: parsed.data.anchor ?? null,
    },
    include: { author: { select: userProjection } },
  });
  const row: DocCommentRow = {
    id: created.id,
    pageId: created.pageId,
    body: created.body,
    anchor: created.anchor,
    createdAt: created.createdAt.toISOString(),
    author: created.author
      ? {
          id: created.author.id,
          displayName: created.author.displayName,
          githubLogin: created.author.githubLogin,
          avatarUrl: created.author.avatarUrl,
        }
      : null,
  };
  res.status(201).json(row);
});

devdocsRouter.delete("/comments/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const existing = await prisma.docComment.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Comment not found" });
  if (existing.authorId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  await prisma.docComment.delete({ where: { id: existing.id } });
  res.status(204).end();
});

const staleBody = z.object({
  reason: z.string().max(2000).optional(),
});

devdocsRouter.post("/pages/:pageId/stale-reports", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const parsed = staleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const page = await prisma.docPage.findUnique({
    where: { id: req.params.pageId },
    select: { id: true },
  });
  if (!page) return res.status(404).json({ error: "Doc page not found" });

  // One open report per (pageId, reporterId): reuse the existing unresolved one instead of duplicating.
  const existing = await prisma.docStaleReport.findFirst({
    where: { pageId: page.id, reporterId: req.user.id, resolvedAt: null },
  });
  const row =
    existing ??
    (await prisma.docStaleReport.create({
      data: {
        pageId: page.id,
        reporterId: req.user.id,
        reason: parsed.data.reason ?? null,
      },
    }));
  const out: DocStaleReportRow = {
    id: row.id,
    pageId: row.pageId,
    reason: row.reason,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    reporterId: row.reporterId,
  };
  res.status(existing ? 200 : 201).json(out);
});

devdocsRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ query: q, hits: [] });
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const limit = Number(req.query.limit) || 20;
  const hits = await getDevDocsHits(q, { entityId, limit });
  res.json({ query: q, hits });
});
