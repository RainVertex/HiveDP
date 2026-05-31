import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, type TeamPolicyKind } from "@internal/db";
import type { TeamPolicyDto, TeamPolicyViolation } from "@internal/shared-types";
// Team naming/policy registry plus admin CRUD routes; validators live in code (no DB-driven eval/JSON-DSL).
import { audit } from "./helpers";

export interface PolicyContext {
  slug: string;
  name: string;
  description: string | null;
}

export interface PolicyDefinition<C> {
  kind: TeamPolicyKind;
  label: string;
  defaultConfig: C;
  /** Returns the first violation found, or null if the input passes. */
  validate(ctx: PolicyContext, config: C): TeamPolicyViolation | null;
}

interface NamePatternConfig {
  requireSuffix: string;
  requireHyphenSeparation: boolean;
}

const namePatternPolicy: PolicyDefinition<NamePatternConfig> = {
  kind: "name_pattern",
  label: "Team name pattern",
  defaultConfig: {
    requireSuffix: "-team",
    requireHyphenSeparation: true,
  },
  validate(ctx, config) {
    const slug = ctx.slug;
    if (config.requireSuffix && !slug.endsWith(config.requireSuffix)) {
      return {
        policyKind: "name_pattern",
        field: "slug",
        message: `Slug must end with "${config.requireSuffix}" (e.g. backend${config.requireSuffix}).`,
      };
    }
    if (config.requireHyphenSeparation) {
      // Requires multi-word with hyphen separation: no leading, trailing, or consecutive hyphens.
      const ok = /^[a-z0-9]+(-[a-z0-9]+)+$/.test(slug);
      if (!ok) {
        return {
          policyKind: "name_pattern",
          field: "slug",
          message:
            "Slug must use hyphens to separate words (e.g. data-platform-team), with no leading, trailing, or consecutive hyphens.",
        };
      }
    }
    return null;
  },
};

const REGISTRY: Record<TeamPolicyKind, PolicyDefinition<unknown>> = {
  name_pattern: namePatternPolicy as PolicyDefinition<unknown>,
};

const ALL_KINDS = Object.keys(REGISTRY) as TeamPolicyKind[];

export async function runPolicies(ctx: PolicyContext): Promise<TeamPolicyViolation | null> {
  const rows = await prisma.teamPolicy.findMany({ where: { enabled: true } });
  for (const row of rows) {
    const def = REGISTRY[row.kind];
    if (!def) continue;
    const config = mergeConfig(def, row.config);
    const violation = def.validate(ctx, config);
    if (violation) return violation;
  }
  return null;
}

function mergeConfig<C>(def: PolicyDefinition<C>, raw: Prisma.JsonValue): C {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...def.defaultConfig, ...(raw as Record<string, unknown>) } as C;
  }
  return def.defaultConfig;
}

export const teamPoliciesRouter: Router = Router();

teamPoliciesRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await prisma.teamPolicy.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const items: TeamPolicyDto[] = ALL_KINDS.map((kind) => {
      const def = REGISTRY[kind];
      const row = byKind.get(kind);
      const cfg = row ? mergeConfig(def, row.config) : def.defaultConfig;
      return {
        kind,
        label: def.label,
        enabled: row?.enabled ?? false,
        config: cfg as Record<string, unknown>,
        defaultConfig: def.defaultConfig as Record<string, unknown>,
        description: row?.description ?? null,
      };
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().max(1000).nullable().optional(),
});

teamPoliciesRouter.patch("/:kind", async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const kind = req.params.kind as TeamPolicyKind;
    if (!REGISTRY[kind]) {
      res.status(404).json({ error: "Unknown policy kind" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const def = REGISTRY[kind];
    const existing = await prisma.teamPolicy.findUnique({ where: { kind } });
    const beforeConfig = existing ? mergeConfig(def, existing.config) : def.defaultConfig;

    const nextConfig = parsed.data.config
      ? { ...(beforeConfig as Record<string, unknown>), ...parsed.data.config }
      : beforeConfig;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.teamPolicy.upsert({
        where: { kind },
        create: {
          kind,
          enabled: parsed.data.enabled ?? true,
          config: nextConfig as Prisma.InputJsonValue,
          description: parsed.data.description ?? null,
        },
        update: {
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.config ? { config: nextConfig as Prisma.InputJsonValue } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
        },
      });
      const configChanged = JSON.stringify(beforeConfig) !== JSON.stringify(nextConfig);
      await audit(
        tx,
        req,
        "team.policy.updated",
        { kind, enabled: row.enabled, configChanged },
        { kind: "teamPolicy", id: row.id },
      );
      return row;
    });

    const dto: TeamPolicyDto = {
      kind,
      label: def.label,
      enabled: updated.enabled,
      config: mergeConfig(def, updated.config) as Record<string, unknown>,
      defaultConfig: def.defaultConfig as Record<string, unknown>,
      description: updated.description,
    };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
