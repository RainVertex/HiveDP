// Resolves and syncs a catalog entity's DevDocs (README or docs/ tree) from GitHub into DocPage rows.
import { Prisma, prisma } from "@internal/db";
import matter from "gray-matter";
import type { DocResolvedSource } from "@internal/shared-types";
import { parseGithubUrl, readSpecDocs, resolveDocSource } from "./resolver";
import { RepoFetchClient } from "./repo-fetch";

interface PageDraft {
  slug: string;
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown> | null;
  sourceRef: string;
  lastCommitSha: string | null;
  lastCommitAt: Date | null;
  lastCommitBy: string | null;
}

export interface SyncResult {
  entityId: string;
  status: "ok" | "partial" | "failed" | "skipped";
  pageCount: number;
  resolvedSource: DocResolvedSource;
  error?: string;
}

/** Re-sync DevDocs for a single entity. */
export async function syncDevDocsForEntity(entityId: string): Promise<SyncResult> {
  const entity = await prisma.catalogEntity.findUnique({ where: { id: entityId } });
  if (!entity) {
    return {
      entityId,
      status: "failed",
      pageCount: 0,
      resolvedSource: { kind: "none" },
      error: "entity not found",
    };
  }

  const specSource = readSpecDocs(entity);
  if (!entity.repoUrl && !specSource) {
    await writeSyncState(entityId, { kind: "none" }, "ok", 0, null);
    await prisma.docPage.deleteMany({ where: { entityId } });
    return { entityId, status: "skipped", pageCount: 0, resolvedSource: { kind: "none" } };
  }

  // External URL renders as a link in the UI, no markdown to sync.
  if (specSource?.kind === "spec-url") {
    await writeSyncState(entityId, specSource, "ok", 0, null);
    await prisma.docPage.deleteMany({ where: { entityId } });
    return {
      entityId,
      status: "ok",
      pageCount: 0,
      resolvedSource: { kind: "external", url: specSource.url },
    };
  }

  if (!entity.repoUrl) {
    const src: DocResolvedSource = { kind: "none" };
    await writeSyncState(entityId, src, "ok", 0, null);
    await prisma.docPage.deleteMany({ where: { entityId } });
    return { entityId, status: "skipped", pageCount: 0, resolvedSource: src };
  }
  const gh = parseGithubUrl(entity.repoUrl);
  if (!gh) {
    const src: DocResolvedSource = { kind: "none" };
    await writeSyncState(entityId, src, "failed", 0, "repoUrl is not a parseable GitHub URL");
    return {
      entityId,
      status: "failed",
      pageCount: 0,
      resolvedSource: src,
      error: "repoUrl not GitHub",
    };
  }

  const client = new RepoFetchClient({ owner: gh.owner, repo: gh.repo });

  let resolved: DocResolvedSource;
  try {
    if (specSource?.kind === "spec-path") {
      resolved = specSource;
    } else {
      const [hasDocsDir, hasReadme] = await Promise.all([
        client.exists("docs"),
        client.exists("README.md"),
      ]);
      resolved = resolveDocSource(entity, { hasDocsDir, hasReadme });
    }
  } catch (err) {
    const msg = (err as Error).message ?? "probe failed";
    await writeSyncState(entityId, { kind: "none" }, "failed", 0, msg);
    return {
      entityId,
      status: "failed",
      pageCount: 0,
      resolvedSource: { kind: "none" },
      error: msg,
    };
  }

  if (resolved.kind === "none") {
    await writeSyncState(entityId, resolved, "ok", 0, null);
    await prisma.docPage.deleteMany({ where: { entityId } });
    return { entityId, status: "ok", pageCount: 0, resolvedSource: resolved };
  }

  const ref = await client.ref().catch(() => null);
  const sourceRefBase = `github:${gh.owner}/${gh.repo}@${ref ?? "HEAD"}`;

  let drafts: PageDraft[] = [];
  let partial = false;
  try {
    if (resolved.kind === "readme") {
      const body = await client.getFile("README.md");
      if (body !== null) {
        drafts = [await buildDraft("README.md", body, "index", client, sourceRefBase)];
      }
    } else {
      const root = resolved.path ?? "docs";
      const files = await client.listMarkdown(root, 200);
      drafts = await Promise.all(
        files.map((f) =>
          buildDraft(f.path, f.content, slugFromPath(f.path, root), client, sourceRefBase),
        ),
      );
    }
  } catch (err) {
    partial = true;
    await writeSyncState(
      entityId,
      resolved,
      "partial",
      drafts.length,
      (err as Error).message ?? "fetch error",
    );
  }

  await reconcilePages(entityId, drafts);

  if (!partial) {
    await writeSyncState(entityId, resolved, "ok", drafts.length, null);
  }

  return {
    entityId,
    status: partial ? "partial" : "ok",
    pageCount: drafts.length,
    resolvedSource: resolved,
  };
}

async function buildDraft(
  path: string,
  raw: string,
  slug: string,
  client: RepoFetchClient,
  sourceRefBase: string,
): Promise<PageDraft> {
  const parsed = matter(raw);
  const fm =
    parsed.data && Object.keys(parsed.data).length > 0
      ? (parsed.data as Record<string, unknown>)
      : null;
  const title = pickTitle(fm, parsed.content, path);
  const last = await client.lastCommitFor(path);
  return {
    slug,
    path,
    title,
    body: parsed.content,
    frontmatter: fm,
    sourceRef: `${sourceRefBase}:${path}`,
    lastCommitSha: last.sha,
    lastCommitAt: last.date,
    lastCommitBy: last.author,
  };
}

function pickTitle(fm: Record<string, unknown> | null, body: string, path: string): string {
  if (fm) {
    const t = fm.title;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim();
  const base = path.split("/").pop() ?? path;
  const noExt = base.replace(/\.mdx?$/i, "");
  if (noExt.toUpperCase() === "README") return "Overview";
  return noExt
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function slugFromPath(filePath: string, root: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  let rel = filePath;
  if (normalizedRoot && filePath.startsWith(normalizedRoot + "/")) {
    rel = filePath.slice(normalizedRoot.length + 1);
  }
  rel = rel.replace(/\.mdx?$/i, "");
  if (/^README$/i.test(rel) || rel.toLowerCase().endsWith("/readme")) {
    rel = rel.replace(/readme$/i, "index");
  }
  return rel || "index";
}

async function reconcilePages(entityId: string, drafts: PageDraft[]): Promise<void> {
  const slugs = new Set(drafts.map((d) => d.slug));
  await prisma.$transaction(async (tx) => {
    if (drafts.length === 0) {
      await tx.docPage.deleteMany({ where: { entityId } });
      return;
    }
    await tx.docPage.deleteMany({
      where: { entityId, slug: { notIn: Array.from(slugs) } },
    });
    for (const d of drafts) {
      await tx.docPage.upsert({
        where: { entityId_slug: { entityId, slug: d.slug } },
        create: {
          entityId,
          slug: d.slug,
          path: d.path,
          title: d.title,
          body: d.body,
          frontmatter: d.frontmatter ? (d.frontmatter as Prisma.InputJsonValue) : Prisma.JsonNull,
          sourceRef: d.sourceRef,
          lastCommitSha: d.lastCommitSha,
          lastCommitAt: d.lastCommitAt,
          lastCommitBy: d.lastCommitBy,
        },
        update: {
          path: d.path,
          title: d.title,
          body: d.body,
          frontmatter: d.frontmatter ? (d.frontmatter as Prisma.InputJsonValue) : Prisma.JsonNull,
          sourceRef: d.sourceRef,
          lastCommitSha: d.lastCommitSha,
          lastCommitAt: d.lastCommitAt,
          lastCommitBy: d.lastCommitBy,
          syncedAt: new Date(),
        },
      });
    }
  });
}

async function writeSyncState(
  entityId: string,
  resolved: DocResolvedSource,
  status: "ok" | "partial" | "failed",
  pageCount: number,
  error: string | null,
): Promise<void> {
  await prisma.docSyncState.upsert({
    where: { entityId },
    create: {
      entityId,
      status,
      pageCount,
      lastSyncedAt: new Date(),
      lastError: error,
      resolvedSource: resolved as unknown as Prisma.InputJsonValue,
    },
    update: {
      status,
      pageCount,
      lastSyncedAt: new Date(),
      lastError: error,
      resolvedSource: resolved as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function syncAllDevDocs(): Promise<{ entities: number; pageCount: number }> {
  // Per-entity sync is inherently N calls. Bound the pre-loop fetch so it cannot fan out unboundedly.
  const entities = await prisma.catalogEntity.findMany({
    where: { staleSince: null },
    select: { id: true },
    take: 5000,
  });
  if (entities.length === 5000) {
    console.warn(
      "[catalog] devdocs sync hit the 5000-entity cap; remaining entities skipped this run",
    );
  }
  let pageCount = 0;
  for (const e of entities) {
    const result = await syncDevDocsForEntity(e.id).catch(() => null);
    if (result) pageCount += result.pageCount;
  }
  return { entities: entities.length, pageCount };
}
