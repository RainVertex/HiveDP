import { Prisma, prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";

interface Row {
  id: string;
  name: string;
  description: string | null;
}

// name and description are public, hits are not org scoped
export const catalog: SearchSource = async (query, _ctx, limit) => {
  const where = Prisma.sql`("name" % ${query} OR "name" ILIKE ${"%" + query + "%"} OR "description" ILIKE ${"%" + query + "%"})`;

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT "id", "name", "description"
    FROM "CatalogEntity"
    WHERE ${where}
    ORDER BY similarity("name", ${query}) DESC
    LIMIT ${limit}
  `);

  return rows.map(
    (e): SearchHit => ({
      id: e.id,
      kind: "catalog",
      title: e.name,
      snippet: e.description ?? undefined,
      href: `/catalog/${e.id}`,
    }),
  );
};
