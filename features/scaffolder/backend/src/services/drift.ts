// Drift detection: replans active bindings to open ScaffoldDrift rows and reconciles template hash snapshots.
import { prisma } from "@internal/db";
import { buildPlan, contentHashForTemplate, type Actor } from "@internal/scaffolder-core";
import { getActionRegistry, getTemplates } from "./registry";
import { buildPlanCtx } from "./plan-ctx";
import { buildEntityContext } from "./jq-context";

// One-pass drift detection: replans every active binding and opens (or coalesces) ScaffoldDrift rows for non-no-op plans.

export interface DriftSweepInput {
  /** Restrict to a specific templateId. otherwise scans all active bindings. */
  templateId?: string;
  systemUserId?: string;
}

export interface DriftSweepResult {
  bindingsScanned: number;
  driftsOpened: number;
  driftsCoalesced: number;
  errors: number;
}

const SYSTEM_ACTOR_FALLBACK_ID = "system";

function systemActor(userId: string | undefined): Actor {
  return {
    kind: "agent",
    userId: userId ?? SYSTEM_ACTOR_FALLBACK_ID,
    teamIds: [],
  };
}

export async function runDriftSweep(input: DriftSweepInput): Promise<DriftSweepResult> {
  const out: DriftSweepResult = {
    bindingsScanned: 0,
    driftsOpened: 0,
    driftsCoalesced: 0,
    errors: 0,
  };

  const where = {
    active: true,
    ...(input.templateId ? { templateId: input.templateId } : {}),
  };
  const bindings = await prisma.scaffoldBinding.findMany({
    where,
    orderBy: { appliedAt: "asc" },
  });
  out.bindingsScanned = bindings.length;

  const registry = await getTemplates();
  const actions = getActionRegistry();
  const actor = systemActor(input.systemUserId);

  for (const binding of bindings) {
    const template = registry.get(binding.templateId);
    if (!template) {
      out.errors++;
      continue;
    }

    const contentHash = contentHashForTemplate(template);

    // No version bump and no content change means nothing could have drifted.
    if (
      binding.templateVersion === template.metadata.version &&
      binding.templateHash === contentHash
    ) {
      continue;
    }

    try {
      const planCtx = buildPlanCtx({
        actor,
        target: "worktree",
      });
      const entity = await buildEntityContext(binding.catalogEntityId);
      const built = await buildPlan({
        template,
        rawParams: binding.params,
        actor,
        ctx: planCtx,
        templateContentHash: contentHash,
        target: "worktree",
        bindingId: binding.id,
        actions,
        entity,
      });

      if (built.plan.mode === "no-op") {
        // Record the hash so we don't re-scan the same no-op delta; version stays until the plan is applied.
        await prisma.scaffoldBinding.update({
          where: { id: binding.id },
          data: { templateHash: contentHash },
        });
        continue;
      }

      const fromVersion = binding.templateVersion;
      const toVersion = template.metadata.version;
      const existingOpen = await prisma.scaffoldDrift.findFirst({
        where: {
          bindingId: binding.id,
          status: "open",
          fromVersion,
          toVersion,
        },
        select: { id: true },
      });

      if (existingOpen) {
        out.driftsCoalesced++;
        continue;
      }

      await prisma.scaffoldDrift.create({
        data: {
          bindingId: binding.id,
          fromVersion,
          toVersion,
          diffSummary: {
            stepCount: built.plan.steps.length,
            actions: built.plan.steps.map((s) => s.action),
            mutationKinds: Array.from(
              new Set(built.plan.steps.flatMap((s) => s.mutations.map((m) => m.kind))),
            ),
          } as never,
          status: "open",
        },
      });
      out.driftsOpened++;
    } catch {
      out.errors++;
    }
  }

  return out;
}

// Snapshots each template's content hash and returns the templateIds that changed (these need an immediate sweep).
export async function reconcileTemplateHashSnapshots(): Promise<{
  changed: string[];
  unchanged: number;
}> {
  const registry = await getTemplates();
  const templates = registry.list();
  const changed: string[] = [];
  let unchanged = 0;

  for (const template of templates) {
    const hash = contentHashForTemplate(template);
    const existing = await prisma.templateHashSnapshot.findUnique({
      where: { templateId: template.metadata.id },
    });
    if (existing && existing.templateHash === hash) {
      unchanged++;
      continue;
    }
    await prisma.templateHashSnapshot.upsert({
      where: { templateId: template.metadata.id },
      create: {
        templateId: template.metadata.id,
        templateVersion: template.metadata.version,
        templateHash: hash,
      },
      update: {
        templateVersion: template.metadata.version,
        templateHash: hash,
        observedAt: new Date(),
      },
    });
    changed.push(template.metadata.id);
  }

  return { changed, unchanged };
}
