import { Prisma, prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";
import { userOrgLogins } from "./scope";

interface Row {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export const teams: SearchSource = async (query, ctx, limit) => {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"deletedAt" IS NULL`,
    Prisma.sql`("name" % ${query} OR "name" ILIKE ${"%" + query + "%"} OR "description" ILIKE ${"%" + query + "%"})`,
  ];

  if (!ctx.isAdmin) {
    const logins = await userOrgLogins(ctx.userId);
    if (logins.length === 0) return [];
    conditions.push(Prisma.sql`"accountLogin" IN (${Prisma.join(logins)})`);
  }

  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT "id", "slug", "name", "description"
    FROM "Team"
    WHERE ${where}
    ORDER BY similarity("name", ${query}) DESC
    LIMIT ${limit}
  `);

  return rows.map(
    (t): SearchHit => ({
      id: t.id,
      kind: "team",
      title: t.name,
      snippet: t.description ?? undefined,
      href: `/teams/${t.slug}`,
    }),
  );
};
