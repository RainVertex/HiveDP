import { Prisma, prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";
import { memberProjectIds } from "./scope";

interface Row {
  id: string;
  title: string;
  description: string | null;
}

export const tasks: SearchSource = async (query, ctx, limit) => {
  const projectIds = await memberProjectIds(ctx.userId);
  if (projectIds.length === 0) return [];

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT "id", "title", "description"
    FROM "Task"
    WHERE "projectId" IN (${Prisma.join(projectIds)})
      AND ("title" % ${query} OR "title" ILIKE ${"%" + query + "%"} OR "description" ILIKE ${"%" + query + "%"})
    ORDER BY similarity("title", ${query}) DESC
    LIMIT ${limit}
  `);

  return rows.map(
    (t): SearchHit => ({
      id: t.id,
      kind: "task",
      title: t.title,
      snippet: t.description ?? undefined,
      href: `/tasks/${t.id}`,
    }),
  );
};
