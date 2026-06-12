import { prisma } from "@internal/db";
import { isOrgVisible, visibleEntityWhere } from "@feature/catalog-backend/contract";

export async function searchEntities(query: string, scope: string[] | null, kind?: string) {
  const where: Record<string, unknown> = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ],
  };
  if (kind) where.kind = kind;
  const rows = await prisma.catalogEntity.findMany({
    where,
    take: 20,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      lifecycle: true,
      description: true,
      accountLogin: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    accessible: isOrgVisible(scope, row.accountLogin),
  }));
}

export async function getEntityById(entityId: string, scope: string[] | null) {
  const e = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    include: {
      owners: {
        include: { team: { select: { id: true, slug: true, name: true } } },
      },
    },
  });
  if (!e) return null;
  if (!isOrgVisible(scope, e.accountLogin)) {
    return {
      accessible: false as const,
      id: e.id,
      name: e.name,
      kind: e.kind,
      lifecycle: e.lifecycle,
      description: e.description,
      accountLogin: e.accountLogin,
    };
  }
  return {
    accessible: true as const,
    id: e.id,
    name: e.name,
    kind: e.kind,
    lifecycle: e.lifecycle,
    description: e.description,
    repoUrl: e.repoUrl,
    tags: e.tags,
    accountLogin: e.accountLogin,
    owners: e.owners.map((o) => o.team),
  };
}

export async function entitiesOwnedByTeam(teamSlug: string, scope: string[] | null) {
  const team = await prisma.team.findFirst({ where: { slug: teamSlug, deletedAt: null } });
  if (!team) return null;
  const entities = await prisma.catalogEntity.findMany({
    where: { owners: { some: { teamId: team.id } }, ...visibleEntityWhere(scope) },
    select: { id: true, name: true, kind: true, lifecycle: true },
    orderBy: { name: "asc" },
    take: 50,
  });
  return { team: { id: team.id, slug: team.slug, name: team.name }, entities };
}
