// Recommended models per agent "kind", plus whether the kind needs tool
// support. Not every model fits every task, so the UI highlights these and
// the backend enforces requiresTools as a capability guardrail. Slugs must
// match the seeded LlmModel slugs; callers resolve slugs to ids and skip any
// that are not registered/enabled.

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
