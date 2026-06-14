import { prisma, Prisma } from "@internal/db";

export type ModelListItem = Prisma.LlmModelGetPayload<{
  include: {
    provider: {
      select: { id: true; slug: true; displayName: true; kind: true; apiKeyEnvVar: true };
    };
  };
}>;

type ModelCapability = Prisma.LlmModelGetPayload<{
  select: { id: true; enabled: true; supportsTools: true; provider: { select: { enabled: true } } };
}>;

export interface ModelRepository {
  listEnabled(): Promise<ModelListItem[]>;
  findBySlugs(slugs: string[]): Promise<Array<{ id: string; slug: string }>>;
  findCapability(modelId: string): Promise<ModelCapability | null>;
}

export const modelRepository: ModelRepository = {
  listEnabled() {
    return prisma.llmModel.findMany({
      where: { enabled: true, provider: { enabled: true } },
      include: {
        provider: {
          select: { id: true, slug: true, displayName: true, kind: true, apiKeyEnvVar: true },
        },
      },
      orderBy: [{ provider: { slug: "asc" } }, { slug: "asc" }],
    });
  },
  findBySlugs(slugs) {
    return prisma.llmModel.findMany({
      where: { slug: { in: slugs }, enabled: true, provider: { enabled: true } },
      select: { id: true, slug: true },
    });
  },
  findCapability(modelId) {
    return prisma.llmModel.findUnique({
      where: { id: modelId },
      select: {
        id: true,
        enabled: true,
        supportsTools: true,
        provider: { select: { enabled: true } },
      },
    });
  },
};
