import { prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";

// Agents have no owner, they are global and visible to every authenticated user.
// Still substring (Prisma contains) matching, pending conversion to pg_trgm.
export const agents: SearchSource = async (query, _ctx, limit) => {
  const rows = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    take: limit,
    select: { id: true, name: true, description: true },
  });

  return rows.map(
    (a): SearchHit => ({
      id: a.id,
      kind: "agent",
      title: a.name,
      snippet: a.description ?? undefined,
      href: `/agents/${a.id}`,
    }),
  );
};
