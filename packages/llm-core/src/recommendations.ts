// Recommended models and tool requirement per agent kind; slugs must match seeded LlmModel slugs.

export interface KindRecommendation {
  recommendedModelSlugs: string[];
  requiresTools: boolean;
}

const RECOMMENDATIONS: Record<string, KindRecommendation> = {
  "platform-assistant": {
    requiresTools: true,
    recommendedModelSlugs: ["claude-sonnet-4-6", "gpt-4o", "qwen3-8b-local"],
  },
  "catalog-enrichment": {
    requiresTools: true,
    recommendedModelSlugs: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  custom: {
    requiresTools: false,
    recommendedModelSlugs: ["claude-sonnet-4-6", "gpt-4o-mini"],
  },
};

export function recommendationsForKind(kind: string): KindRecommendation {
  return RECOMMENDATIONS[kind] ?? RECOMMENDATIONS.custom;
}
