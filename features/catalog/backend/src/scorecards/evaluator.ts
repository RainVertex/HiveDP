// Evaluates scorecard rules against catalog entities and rolls results up into tiers.

import { Prisma, prisma } from "@internal/db";
import type {
  ScorecardRuleKind,
  ScorecardSummary,
  ScorecardTier,
  ScorecardTierStyle,
} from "@internal/shared-types";
import { appliesToKind, evaluateRule, type RuleContext } from "./rules";

const STAGE_ORDER: Array<"bronze" | "silver" | "gold"> = ["bronze", "silver", "gold"];
const THRESHOLD_ORDER: Array<"red" | "orange" | "yellow" | "green"> = [
  "red",
  "orange",
  "yellow",
  "green",
];

/** Achieved tier is the highest tier with a rule where all rules at or below it pass. */
export function rollupTier(
  tierStyle: ScorecardTierStyle,
  ruleResults: Array<{ tier: string; passed: boolean }>,
): ScorecardTier {
  const order: string[] = tierStyle === "stage" ? STAGE_ORDER : THRESHOLD_ORDER;

  let achieved: ScorecardTier = "none";
  for (const tier of order) {
    const tierIdx = order.indexOf(tier);
    const definedAtTier = ruleResults.some((r) => r.tier === tier);
    if (!definedAtTier) continue;
    const rulesAtOrBelow = ruleResults.filter((r) => {
      const idx = order.indexOf(r.tier);
      return idx !== -1 && idx <= tierIdx;
    });
    if (rulesAtOrBelow.every((r) => r.passed)) {
      achieved = tier as ScorecardTier;
    }
  }
  return achieved;
}

export async function evaluateScorecardsForEntity(entityId: string): Promise<void> {
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: entityId },
    include: { owners: true },
  });
  if (!entity) return;

  const scorecards = await prisma.scorecard.findMany({
    where: { enabled: true },
    include: { rules: true },
  });
  if (scorecards.length === 0) return;

  const [dora, drifts] = await Promise.all([
    prisma.doraMetricsSnapshot.findMany({
      where: { entityId },
      orderBy: { periodEnd: "desc" },
      take: 50,
    }),
    prisma.catalogDrift.findMany({ where: { entityId } }),
  ]);
  const ctx: RuleContext = {
    entity,
    ownerTeamIds: entity.owners.map((o) => o.teamId),
    dora,
    drifts,
  };

  for (const sc of scorecards) {
    if (!appliesToKind(sc.appliesTo, entity.kind)) continue;
    for (const rule of sc.rules) {
      const outcome = evaluateRule(
        { kind: rule.kind as ScorecardRuleKind, config: rule.config as Record<string, unknown> },
        ctx,
      );
      const evidenceValue = (outcome.evidence ?? undefined) as Prisma.InputJsonValue | undefined;
      await prisma.scorecardResult.upsert({
        where: { entityId_ruleId: { entityId, ruleId: rule.id } },
        create: {
          scorecardId: sc.id,
          ruleId: rule.id,
          entityId,
          passed: outcome.passed,
          reason: outcome.reason,
          evidence: evidenceValue,
        },
        update: {
          passed: outcome.passed,
          reason: outcome.reason,
          evidence: evidenceValue,
          evaluatedAt: new Date(),
        },
      });
    }
  }
}

export async function evaluateAllScorecards(): Promise<{ entities: number; results: number }> {
  const entities = await prisma.catalogEntity.findMany({
    where: { staleSince: null },
    select: { id: true },
  });
  let results = 0;
  for (const e of entities) {
    const before = await prisma.scorecardResult.count({ where: { entityId: e.id } });
    await evaluateScorecardsForEntity(e.id);
    const after = await prisma.scorecardResult.count({ where: { entityId: e.id } });
    results += after - before;
  }
  return { entities: entities.length, results };
}

export async function getScorecardSummariesForEntity(
  entityId: string,
): Promise<ScorecardSummary[]> {
  const entity = await prisma.catalogEntity.findUnique({ where: { id: entityId } });
  if (!entity) return [];

  const scorecards = await prisma.scorecard.findMany({
    where: { enabled: true },
    include: { rules: { orderBy: { tier: "asc" } } },
  });

  const results = await prisma.scorecardResult.findMany({ where: { entityId } });
  const resultsByRule = new Map(results.map((r) => [r.ruleId, r]));

  const summaries: ScorecardSummary[] = [];
  for (const sc of scorecards) {
    if (!appliesToKind(sc.appliesTo, entity.kind)) continue;
    const ruleRows = sc.rules.map((rule) => ({
      rule: {
        id: rule.id,
        key: rule.key,
        label: rule.label,
        kind: rule.kind as ScorecardRuleKind,
        tier: rule.tier as ScorecardSummary["rules"][number]["rule"]["tier"],
      },
      result: (resultsByRule.get(rule.id) ?? null) as ScorecardSummary["rules"][number]["result"],
    }));
    const ruleResults = ruleRows.map((r) => ({
      tier: r.rule.tier,
      passed: r.result?.passed ?? false,
    }));
    summaries.push({
      scorecard: { id: sc.id, slug: sc.slug, name: sc.name, tierStyle: sc.tierStyle },
      tier: rollupTier(sc.tierStyle, ruleResults),
      rulesPassed: ruleResults.filter((r) => r.passed).length,
      rulesTotal: ruleResults.length,
      rules: ruleRows,
    });
  }
  return summaries;
}
