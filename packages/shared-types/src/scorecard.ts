// Wire shapes for scorecards: tier definitions, rules, and per-entity evaluation results.
import type { ID, ISODateString, Timestamped } from "./common";
import type { CatalogEntityKind } from "./catalog";

export type ScorecardTierStyle = "stage" | "threshold";

// Stage-style ordering: bronze < silver < gold.
export type ScorecardTier =
  | "bronze"
  | "silver"
  | "gold"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "none";

export type ScorecardRuleKind =
  | "field_present"
  | "has_owner"
  | "lifecycle_in"
  | "tag_present"
  | "dora_threshold"
  | "drift_count_max";

export interface Scorecard extends Timestamped {
  id: ID;
  slug: string;
  name: string;
  description: string | null;
  appliesTo: CatalogEntityKind[];
  tierStyle: ScorecardTierStyle;
  enabled: boolean;
  rules?: ScorecardRule[];
}

export interface ScorecardRule {
  id: ID;
  scorecardId: ID;
  key: string;
  label: string;
  kind: ScorecardRuleKind;
  config: Record<string, unknown>;
  weight: number;
  tier: Exclude<ScorecardTier, "none">;
}

export interface ScorecardResultRow {
  id: ID;
  scorecardId: ID;
  ruleId: ID;
  entityId: ID;
  passed: boolean;
  reason: string | null;
  evidence: Record<string, unknown> | null;
  evaluatedAt: ISODateString;
}

export interface ScorecardSummary {
  scorecard: Pick<Scorecard, "id" | "slug" | "name" | "tierStyle">;
  tier: ScorecardTier;
  rulesPassed: number;
  rulesTotal: number;
  rules: Array<{
    rule: Pick<ScorecardRule, "id" | "key" | "label" | "kind" | "tier">;
    result: ScorecardResultRow | null;
  }>;
}
