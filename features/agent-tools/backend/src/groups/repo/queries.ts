import { prisma } from "@internal/db";

export async function getEntityRepoFields(entityId: string) {
  return prisma.catalogEntity.findUnique({
    where: { id: entityId },
    select: { repoUrl: true, installationId: true, accountLogin: true },
  });
}
