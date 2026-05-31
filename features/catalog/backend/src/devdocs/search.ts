// Full-text DevDocs search over DocPage via Postgres tsvector/ts_rank.
import { Prisma, prisma } from "@internal/db";
import type { DocSearchHit, SearchHit } from "@internal/shared-types";

export interface DevDocsSearchOpts {
  entityId?: string;
  limit?: number;
}

interface RawHit {
  pageId: string;
  entityId: string;
  entityName: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number;
}

export async function getDevDocsHits(
  query: string,
  opts: DevDocsSearchOpts = {},
): Promise<DocSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

  // Strip ts_headline markers so the API stays tag-free; UI highlights client-side.
  const tsQuery = Prisma.sql`plainto_tsquery('english', ${trimmed})`;
  const where = opts.entityId
    ? Prisma.sql`p."searchVector" @@ ${tsQuery} AND p."entityId" = ${opts.entityId}`
    : Prisma.sql`p."searchVector" @@ ${tsQuery}`;

  const rows = await prisma.$queryRaw<RawHit[]>(Prisma.sql`
    SELECT p."id"        AS "pageId",
           p."entityId"  AS "entityId",
           e."name"      AS "entityName",
           p."slug"      AS "slug",
           p."title"     AS "title",
           ts_headline('english', p."body", ${tsQuery},
                       'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=20,MinWords=8') AS "snippet",
           ts_rank(p."searchVector", ${tsQuery}) AS "rank"
    FROM "DocPage" p
    JOIN "CatalogEntity" e ON e."id" = p."entityId"
    WHERE ${where}
    ORDER BY "rank" DESC, p."lastCommitAt" DESC NULLS LAST
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    pageId: r.pageId,
    entityId: r.entityId,
    entityName: r.entityName,
    slug: r.slug,
    title: r.title,
    snippet: stripHeadlineMarkers(r.snippet),
    rank: Number(r.rank),
  }));
}

function stripHeadlineMarkers(s: string | null): string {
  if (!s) return "";
  return s.replace(/<<|>>/g, "");
}

/** Adapter for the global search router: maps DocSearchHit to SearchHit. */
export async function getDevDocsSearchHits(query: string, limit = 10): Promise<SearchHit[]> {
  const hits = await getDevDocsHits(query, { limit });
  return hits.map((h) => ({
    id: h.pageId,
    kind: "devdoc" as const,
    title: `${h.entityName} / ${h.title}`,
    snippet: h.snippet,
    href: `/catalog/${h.entityId}/docs?p=${encodeURIComponent(h.slug)}`,
  }));
}
