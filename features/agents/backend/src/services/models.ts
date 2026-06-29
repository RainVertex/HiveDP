import { prisma } from "@internal/db";
import { isProviderReady, providerHasStoredKey, recommendationsForKind } from "@internal/llm-core";
import { isCodingCapableProviderKind } from "@feature/agents-shared";
import { BadRequestError } from "../errors";
import { toModelDto, toRecommendations } from "../mappers";
import { modelRepository } from "../repositories/models";

// The coding runtime drives Aider (model-agnostic), so a coding agent just needs a model on a provider
// the runtime knows how to map to Aider (OpenAI, Anthropic, Gemini, Ollama).
export async function assertRuntimeSupported(modelId: string, runtime: string): Promise<void> {
  if (runtime !== "code") return;
  const model = await prisma.llmModel.findUnique({
    where: { id: modelId },
    select: { provider: { select: { kind: true } } },
  });
  if (!model) throw new BadRequestError("modelId is not a registered model");
  if (!isCodingCapableProviderKind(model.provider.kind)) {
    throw new BadRequestError(
      "Coding agents need a model on a supported provider (OpenAI, Anthropic, Gemini, or Ollama).",
      "coding_unsupported_provider",
    );
  }
}

// Gates on whether any skill is selected, not on the expanded tool count, so the same agent config
// validates identically regardless of an env flag that gates a skill's tools (e.g. chat writes).
export async function validateModelForSkills(modelId: string, skillIds: string[]): Promise<void> {
  const model = await modelRepository.findCapability(modelId);
  if (!model || !model.enabled || !model.provider.enabled) {
    throw new BadRequestError("modelId is not a registered, enabled model");
  }
  if (skillIds.length > 0 && !model.supportsTools) {
    throw new BadRequestError(
      "This model does not support tools. Pick a tool-capable model or remove the skills.",
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

export async function recommendations(kind: string, runtime?: string) {
  const rec = recommendationsForKind(kind, runtime);
  const models = await modelRepository.findBySlugs(rec.recommendedModelSlugs);
  const bySlug = new Map(models.map((m) => [m.slug, m.id]));
  const recommendedModelIds = rec.recommendedModelSlugs
    .map((s) => bySlug.get(s))
    .filter((id): id is string => Boolean(id));
  return toRecommendations(kind, rec.requiresTools, recommendedModelIds);
}
