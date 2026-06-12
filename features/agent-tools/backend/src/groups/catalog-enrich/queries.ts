import { prisma } from "@internal/db";

export async function getEntityWithOwners(entityId: string) {
  return prisma.catalogEntity.findUnique({
    where: { id: entityId },
    include: {
      owners: {
        include: { team: { select: { id: true, slug: true, name: true } } },
      },
    },
  });
}

export async function getEntityRepoFields(entityId: string) {
  return prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: { repoUrl: true, installationId: true, accountLogin: true },
  });
}
