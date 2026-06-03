import { prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";
import { memberProjectIds } from "./scope";

// Still substring (Prisma contains) matching, pending conversion to pg_trgm.
export const projects: SearchSource = async (query, ctx, limit) => {
  const projectIds = await memberProjectIds(ctx.userId);
  if (projectIds.length === 0) return [];

  const rows = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      isArchived: false,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    take: limit,
    select: { id: true, title: true, description: true },
  });

  return rows.map(
    (p): SearchHit => ({
      id: p.id,
      kind: "project",
      title: p.title,
      snippet: p.description ?? undefined,
      href: `/projects/${p.id}`,
    }),
  );
};
