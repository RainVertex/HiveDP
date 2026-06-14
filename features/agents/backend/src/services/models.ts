import { isProviderReady, providerHasStoredKey, recommendationsForKind } from "@internal/llm-core";
import { BadRequestError } from "../errors";
import { toModelDto, toRecommendations } from "../mappers";
import { modelRepository } from "../repositories/models";

export async function validateModelForTools(modelId: string, toolIds: string[]): Promise<void> {
  const model = await modelRepository.findCapability(modelId);
  if (!model || !model.enabled || !model.provider.enabled) {
    throw new BadRequestError("modelId is not a registered, enabled model");
  }
  if (toolIds.length > 0 && !model.supportsTools) {
    throw new BadRequestError(
      "This model does not support tools. Pick a tool-capable model or remove the tools.",
      "model_lacks_tools",
    );
  }
}

export async function listModels() {
  const models = await modelRepository.listEnabled();
  const readyByProvider = new Map<string, boolean>();
  for (const m of models) {
    if (!readyByProvider.has(m.provider.id)) {
      const hasStoredKey = await providerHasStoredKey(m.provider.id);
      readyByProvider.set(m.provider.id, isProviderReady(m.provider, hasStoredKey));
    }
  }
  return models.map((m) => toModelDto(m, readyByProvider.get(m.provider.id) ?? false));
}

export async function recommendations(kind: string) {
  const rec = recommendationsForKind(kind);
  const models = await modelRepository.findBySlugs(rec.recommendedModelSlugs);
  const bySlug = new Map(models.map((m) => [m.slug, m.id]));
  const recommendedModelIds = rec.recommendedModelSlugs
    .map((s) => bySlug.get(s))
    .filter((id): id is string => Boolean(id));
  return toRecommendations(kind, rec.requiresTools, recommendedModelIds);
}
