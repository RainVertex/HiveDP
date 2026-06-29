// Recommended models and tool requirement per agent kind; slugs must match seeded LlmModel slugs.

export interface KindRecommendation {
  recommendedModelSlugs: string[];
  requiresTools: boolean;
}

const RECOMMENDATIONS: Record<string, KindRecommendation> = {
  "platform-assistant": {
    requiresTools: true,
    recommendedModelSlugs: ["o4-mini", "claude-sonnet-4-6", "gpt-4o", "qwen3-8b-local"],
  },
  "catalog-enrichment": {
    requiresTools: true,
    recommendedModelSlugs: ["o4-mini", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  custom: {
    requiresTools: false,
    recommendedModelSlugs: ["claude-sonnet-4-6", "gpt-4o-mini"],
  },
};

// The code runtime drives Aider (no function-calling needed), so it just wants a strong coding model.
const CODING_RECOMMENDATION: KindRecommendation = {
  requiresTools: false,
  recommendedModelSlugs: ["gpt-5.5", "gpt-5.4", "claude-opus-4-7", "claude-sonnet-4-6"],
};

// Runtime takes precedence over kind: a coding agent always wants coding models regardless of its kind.
export function recommendationsForKind(kind: string, runtime?: string): KindRecommendation {
  if (runtime === "code") return CODING_RECOMMENDATION;
  return RECOMMENDATIONS[kind] ?? RECOMMENDATIONS.custom;
}
