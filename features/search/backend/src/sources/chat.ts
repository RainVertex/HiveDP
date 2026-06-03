import { prisma } from "@internal/db";
import type { SearchHit } from "@internal/shared-types";
import type { SearchSource } from "./types";

// Scoped to the user's own conversations, matches the title or any message body within them.
// Still substring (Prisma contains) matching, pending conversion to pg_trgm.
export const chat: SearchSource = async (query, ctx, limit) => {
  const rows = await prisma.chatConversation.findMany({
    where: {
      userId: ctx.userId,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { messages: { some: { content: { contains: query, mode: "insensitive" } } } },
      ],
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });

  return rows.map(
    (c): SearchHit => ({
      id: c.id,
      kind: "chat",
      title: c.title,
      href: `/chat/${c.id}`,
    }),
  );
};
