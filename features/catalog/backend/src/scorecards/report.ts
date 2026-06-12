// Cross-entity leaderboard and per-entity history for a scorecard.

import { prisma } from "@internal/db";
import type {
  CatalogEntityKind,
  ScorecardHistoryPoint,
  ScorecardReport,
  ScorecardReportRow,
  ScorecardTier,
} from "@internal/shared-types";
import { appliesToKind } from "./rules";
import { computeScorePercent, rollupTier } from "./evaluator";

export interface ScorecardReportFilters {
  kind?: CatalogEntityKind;
  ownerTeamId?: string;
  accountLogins?: string[];
}

// Best tier first, so the leaderboard reads top to bottom; stage and threshold palettes share ranks.
const TIER_RANK: Record<string, number> = {
  none: 0,
  red: 1,
  bronze: 1,
  orange: 2,
  silver: 2,
  yellow: 3,
  gold: 3,
  green: 4,
};

function tierRank(tier: ScorecardTier): number {
  return TIER_RANK[tier] ?? 0;
}

export async function getScorecardReport(
  scorecardId: string,
  filters: ScorecardReportFilters = {},
): Promise<ScorecardReport | null> {
  const sc = await prisma.scorecard.findUnique({
    where: { id: scorecardId },
    include: { rules: true },
  });
  if (!sc) return null;

  const entities = await prisma.catalogEntity.findMany({
    where: {
      staleSince: null,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.ownerTeamId ? { owners: { some: { teamId: filters.ownerTeamId } } } : {}),
      ...(filters.accountLogins ? { accountLogin: { in: filters.accountLogins } } : {}),
    },
    include: { owners: true },
  });
  const applicable = entities.filter((e) => appliesToKind(sc.appliesTo, e.kind));

  const results = await prisma.scorecardResult.findMany({
    where: { scorecardId: sc.id, entityId: { in: applicable.map((e) => e.id) } },
  });
  const passedByEntityRule = new Map<string, Map<string, boolean>>();
  for (const r of results) {
    let byRule = passedByEntityRule.get(r.entityId);
    if (!byRule) {
      byRule = new Map();
      passedByEntityRule.set(r.entityId, byRule);
    }
    byRule.set(r.ruleId, r.passed);
  }

  const rows: ScorecardReportRow[] = applicable.map((e) => {
    const byRule = passedByEntityRule.get(e.id);
    const ruleResults = sc.rules.map((rule) => ({
      tier: rule.tier,
      passed: byRule?.get(rule.id) ?? false,
      weight: rule.weight,
    }));
    return {
      entity: { id: e.id, name: e.name, kind: e.kind },
      ownerTeamIds: e.owners.map((o) => o.teamId),
      tier: rollupTier(sc.tierStyle, ruleResults),
      scorePercent: computeScorePercent(ruleResults),
      rulesPassed: ruleResults.filter((r) => r.passed).length,
      rulesTotal: ruleResults.length,
    };
  });

  rows.sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || b.scorePercent - a.scorePercent);

  return {
    scorecard: { id: sc.id, slug: sc.slug, name: sc.name, tierStyle: sc.tierStyle },
    rows,
  };
}

export async function getScorecardHistory(
  scorecardId: string,
  entityId: string,
  take = 50,
): Promise<ScorecardHistoryPoint[]> {
  const rows = await prisma.scorecardEntitySnapshot.findMany({
    where: { scorecardId, entityId },
    orderBy: { capturedAt: "desc" },
    take,
  });
  return rows.reverse().map((r) => ({
    tier: r.tier as ScorecardTier,
    scorePercent: r.scorePercent,
    rulesPassed: r.rulesPassed,
    rulesTotal: r.rulesTotal,
    capturedAt: r.capturedAt.toISOString(),
  }));
}
