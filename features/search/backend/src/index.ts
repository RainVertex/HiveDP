import { Router } from "express";
import { prisma } from "@internal/db";
import { getDevDocsSearchHits } from "@feature/catalog-backend";
import type { SearchHit, SearchResults } from "@internal/shared-types";

export const searchRouter: Router = Router();

searchRouter.get("/", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) return res.json({ query, hits: [] } satisfies SearchResults);

  const [entities, teams, agents, devdocs] = await Promise.all([
    prisma.catalogEntity.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: 10,
    }),
    prisma.team.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: 10,
    }),
    prisma.agent.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: 10,
    }),
    getDevDocsSearchHits(query, 10).catch(() => [] as SearchHit[]),
  ]);

  const hits: SearchHit[] = [
    ...entities.map((e) => ({
      id: e.id,
      kind: "catalog" as const,
      title: e.name,
      snippet: e.description ?? undefined,
    })),
    ...teams.map((t) => ({
      id: t.id,
      kind: "team" as const,
      title: t.name,
      snippet: t.description ?? undefined,
    })),
    ...agents.map((a) => ({
      id: a.id,
      kind: "agent" as const,
      title: a.name,
      snippet: a.description ?? undefined,
    })),
    ...devdocs,
  ];

  res.json({ query, hits } satisfies SearchResults);
});
