// Builds the PlanCtx that scaffolder plans use to read repo, DB, and identity state.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { prisma } from "@internal/db";
import {
  stringHelpers,
  type Actor,
  type Binding,
  type PlanCtx,
  type SandboxTarget,
} from "@internal/scaffolder-core";

export interface BuildPlanCtxInput {
  actor: Actor;
  target: SandboxTarget;
  liveRepoRoot: string;
  // Frozen wall-clock for the plan, defaults to new Date().
  now?: Date;
}

export function buildPlanCtx(input: BuildPlanCtxInput): PlanCtx {
  const frozenNow = input.now ?? new Date();
  return {
    actor: input.actor,
    target: input.target,
    now: () => new Date(frozenNow),
    existsInRepo: async (relPath) => {
      try {
        await fs.access(join(input.liveRepoRoot, relPath));
        return true;
      } catch {
        return false;
      }
    },
    readRepoFile: async (relPath) => {
      try {
        return await fs.readFile(join(input.liveRepoRoot, relPath), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    readBinding: async (targetRef) => {
      const row = await prisma.scaffoldBinding.findFirst({ where: { targetRef } });
      if (!row) return null;
      return {
        id: row.id,
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        templateHash: row.templateHash,
        paramsHash: row.paramsHash,
        params: row.params as Record<string, unknown>,
        targetKind: row.targetKind as Binding["targetKind"],
        targetRef: row.targetRef,
        target: row.target as Binding["target"],
        branchName: row.branchName,
        prUrl: row.prUrl,
        ownerTeamId: row.ownerTeamId,
        catalogEntityId: row.catalogEntityId,
        active: row.active,
        appliedByUserId: row.appliedByUserId,
        appliedAt: row.appliedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
    currentTeam: async (id) => {
      const row = await prisma.team.findUnique({
        where: { id },
        select: { id: true, slug: true, name: true },
      });
      return row;
    },
    currentUser: async (id) => {
      const row = await prisma.user.findUnique({
        where: { id },
        select: { id: true, displayName: true, email: true },
      });
      return row;
    },
    toTitle: stringHelpers.toTitle,
    toCamel: stringHelpers.toCamel,
    toPascal: stringHelpers.toPascal,
    toKebab: stringHelpers.toKebab,
  };
}
