import { prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";

// Owned, non-deleted, non-folder pages. Dashboards open in-app, link pages route to their url.
// Still substring (Prisma contains) matching, pending conversion to pg_trgm.
export const pages: SearchSource = async (query, ctx, limit) => {
  const rows = await prisma.page.findMany({
    where: {
      ownerUserId: ctx.userId,
      deletedAt: null,
      isFolder: false,
      title: { contains: query, mode: "insensitive" },
    },
    take: limit,
    select: { id: true, title: true, type: true, url: true },
  });

  return rows.map(
    (p): SearchHit => ({
      id: p.id,
      kind: "page",
      title: p.title,
      href: p.type === "LINK" && p.url ? p.url : `/p/${p.id}`,
    }),
  );
};
