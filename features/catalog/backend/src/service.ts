// Canonical write path and helpers for catalog entities (register, drift, staleness).
import {
  Prisma,
  prisma,
  type CatalogEntity,
  type CatalogEntityKind,
  type CatalogEntitySource,
  type Lifecycle,
} from "@internal/db";
import { notify } from "@feature/notifications-backend/contract";
import { evaluateScorecardsForEntity } from "./scorecards/evaluator";
import { syncDevDocsForEntity } from "./devdocs/sync";

// The platform's own repository (from deploy config) gets its catalog entity tagged "platform", so the
// Platform Assistant can resolve "its own" repo from the catalog instead of an admin setting.
const PLATFORM_TAG = "platform";
const PLATFORM_REPO = normalizeRepoSlug(process.env.PLATFORM_REPO_URL ?? null);

export type RegisterCatalogEntityInput = {
  kind: CatalogEntityKind;
  lifecycle?: Lifecycle;
  name: string;
  description?: string | null;
  ownerTeamIds?: string[] | null;
  repoUrl?: string | null;
  tags?: string[];
  yamlSpec?: Prisma.InputJsonValue | null;
  // Required on create; preserved on update (cross-org transfers are not allowed).
  accountLogin?: string;
};

export type RegisterCatalogEntityOptions = {
  source: CatalogEntitySource;
  sourceRef?: string | null;
  /** When true, skips DB writes and returns the would-be result. */
  dryRun?: boolean;
  /** GitHub App auto-import bookkeeping. */
  needsOnboarding?: boolean;
  installationId?: number | null;
  githubRepoId?: number | null;
};

export type RegisterCatalogEntityResult = {
  entityId: string;
  action: "created" | "updated" | "noop";
  before: CatalogEntity | null;
  after: CatalogEntity | null;
};

/** Single canonical write path for catalog entities. */
export async function registerCatalogEntity(
  rawInput: RegisterCatalogEntityInput,
  opts: RegisterCatalogEntityOptions,
): Promise<RegisterCatalogEntityResult> {
  // githubRepoId is stable across renames so it wins; fall back to (name, kind) for the claim path.
  const existing = await findExisting(rawInput, opts);
  // Re-applied on every write so the marker survives the per-sync tag overwrite from catalog-info.yaml.
  const input = applyPlatformTag(rawInput, existing);

  if (opts.dryRun) {
    return {
      entityId: existing?.id ?? "dry-run",
      action: existing ? "updated" : "created",
      before: existing,
      after: null,
    };
  }

  // Resolve from input override or existing so a manual owner edit flips unowned on next write.
  const finalOwners =
    input.ownerTeamIds !== undefined
      ? (input.ownerTeamIds ?? [])
      : existing
        ? existing.owners.map((o) => o.teamId)
        : [];

  if (!existing) {
    // Auto-sync callers omit accountLogin; derive it from installationId. Manual paths pass it directly.
    let accountLogin = input.accountLogin ?? null;
    if (!accountLogin && opts.installationId != null) {
      accountLogin = await resolveAccountLoginByInstallation(opts.installationId);
    }
    if (!accountLogin) {
      throw new Error("accountLogin is required when creating a catalog entity");
    }
    await assertOwnerTeamsMatchOrg(finalOwners, accountLogin);
    const created = await prisma.catalogEntity.create({
      data: {
        kind: input.kind,
        lifecycle: input.lifecycle,
        name: input.name,
        description: input.description ?? null,
        repoUrl: input.repoUrl ?? null,
        tags: input.tags ?? [],
        source: opts.source,
        sourceRef: opts.sourceRef ?? null,
        accountLogin,
        yamlSpec: input.yamlSpec ?? Prisma.JsonNull,
        lastSeenAt: new Date(),
        needsOnboarding: opts.needsOnboarding ?? false,
        unowned: finalOwners.length === 0 && opts.source === "discovery",
        installationId: opts.installationId ?? null,
        githubRepoId: opts.githubRepoId ?? null,
        owners:
          finalOwners.length > 0
            ? { create: finalOwners.map((teamId) => ({ teamId })) }
            : undefined,
      },
    });
    fireScorecardEvaluation(created.id);
    fireDevDocsSync(created.id);
    return { entityId: created.id, action: "created", before: null, after: created };
  }

  const patch: Prisma.CatalogEntityUncheckedUpdateInput = {
    source: opts.source,
    sourceRef: opts.sourceRef ?? existing.sourceRef,
    lastSeenAt: new Date(),
    staleSince: null,
  };
  if (input.description !== undefined) patch.description = input.description;
  if (input.lifecycle !== undefined) patch.lifecycle = input.lifecycle;
  if (input.repoUrl !== undefined) patch.repoUrl = input.repoUrl;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.yamlSpec !== undefined) {
    patch.yamlSpec = input.yamlSpec === null ? Prisma.JsonNull : input.yamlSpec;
  }
  // Only rewrite name/kind on a githubRepoId match, else a (name, kind) match would lose identity.
  if (opts.githubRepoId != null && existing.githubRepoId === opts.githubRepoId) {
    if (input.name !== existing.name) patch.name = input.name;
    if (input.kind !== existing.kind) patch.kind = input.kind;
  }
  // Sticky one-way flip true to false; a later stub write must not resurrect the onboarding flag.
  if (opts.needsOnboarding === false && existing.needsOnboarding) {
    patch.needsOnboarding = false;
  }
  patch.unowned = finalOwners.length === 0 && opts.source === "discovery";
  // Write-once for installationId/githubRepoId, except on revival where a new install must overwrite the old id.
  const isReviving = existing.staleSince !== null;
  if (opts.installationId != null && (existing.installationId == null || isReviving)) {
    patch.installationId = opts.installationId;
  }
  if (opts.githubRepoId != null && existing.githubRepoId == null) {
    patch.githubRepoId = opts.githubRepoId;
  }

  if (isNoopUpdate(existing, input, opts)) {
    return { entityId: existing.id, action: "noop", before: existing, after: existing };
  }

  if (input.ownerTeamIds !== undefined) {
    await assertOwnerTeamsMatchOrg(input.ownerTeamIds ?? [], existing.accountLogin);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.catalogEntity.update({
      where: { id: existing.id },
      data: patch,
    });
    if (input.ownerTeamIds !== undefined) {
      const desired = input.ownerTeamIds ?? [];
      const before = existing.owners.map((o) => o.teamId);
      const removed = before.filter((id) => !desired.includes(id));
      const added = desired.filter((id) => !before.includes(id));
      await tx.catalogEntityOwner.deleteMany({ where: { entityId: existing.id } });
      if (desired.length > 0) {
        await tx.catalogEntityOwner.createMany({
          data: desired.map((teamId) => ({ entityId: existing.id, teamId })),
          skipDuplicates: true,
        });
      }
      if (removed.length > 0 || added.length > 0) {
        await notifyCatalogOwnershipChanged(tx, {
          entityId: existing.id,
          entityName: existing.name,
          removedTeamIds: removed,
          addedTeamIds: added,
        });
      }
    }
    return row;
  });
  fireScorecardEvaluation(existing.id);
  fireDevDocsSync(existing.id);
  return { entityId: existing.id, action: "updated", before: existing, after: updated };
}

// System event with no actor, so every member of a team gaining or losing ownership is notified.
async function notifyCatalogOwnershipChanged(
  tx: Prisma.TransactionClient,
  args: { entityId: string; entityName: string; removedTeamIds: string[]; addedTeamIds: string[] },
): Promise<void> {
  const teamIds = [...new Set([...args.removedTeamIds, ...args.addedTeamIds])];
  if (teamIds.length === 0) return;
  const memberships = await tx.teamMembership.findMany({
    where: { teamId: { in: teamIds } },
    select: { userId: true },
  });
  const recipients = new Set(memberships.map((m) => m.userId));
  for (const recipientUserId of recipients) {
    await notify(tx, {
      recipientUserId,
      kind: "catalog.entity.ownershipChanged",
      payload: {
        entityId: args.entityId,
        entityName: args.entityName,
        removedTeamIds: args.removedTeamIds,
        addedTeamIds: args.addedTeamIds,
      },
    });
  }
}

async function findExisting(input: RegisterCatalogEntityInput, opts: RegisterCatalogEntityOptions) {
  if (opts.githubRepoId != null) {
    const byRepoId = await prisma.catalogEntity.findUnique({
      where: { githubRepoId: opts.githubRepoId },
      include: { owners: true },
    });
    if (byRepoId) return byRepoId;
  }
  return prisma.catalogEntity.findUnique({
    where: { name_kind: { name: input.name, kind: input.kind } },
    include: { owners: true },
  });
}

function fireScorecardEvaluation(entityId: string): void {
  // Fire-and-forget; the catalog.scorecardEvaluator job reconciles on its next run.
  void evaluateScorecardsForEntity(entityId).catch(() => {});
}

function fireDevDocsSync(entityId: string): void {
  // Fire-and-forget; the catalog.devdocsSync job reconciles anything missed here.
  void syncDevDocsForEntity(entityId).catch(() => {});
}

function isNoopUpdate(
  existing: CatalogEntity & { owners: { teamId: string }[] },
  input: RegisterCatalogEntityInput,
  opts: RegisterCatalogEntityOptions,
): boolean {
  if (existing.staleSince !== null) return false;
  if (existing.source !== opts.source) return false;
  if (
    opts.sourceRef !== undefined &&
    opts.sourceRef !== null &&
    existing.sourceRef !== opts.sourceRef
  ) {
    return false;
  }
  if (input.description !== undefined && input.description !== existing.description) return false;
  if (input.lifecycle !== undefined && input.lifecycle !== existing.lifecycle) return false;
  if (input.ownerTeamIds !== undefined) {
    const existingIds = existing.owners.map((o) => o.teamId).sort();
    const desiredIds = [...(input.ownerTeamIds ?? [])].sort();
    if (!sameStringArray(existingIds, desiredIds)) return false;
  }
  if (input.repoUrl !== undefined && input.repoUrl !== existing.repoUrl) return false;
  if (input.tags !== undefined && !sameStringArray(input.tags, existing.tags)) return false;
  if (input.yamlSpec !== undefined) return false;
  // Flipping needsOnboarding off or populating missing installationId/githubRepoId is a real write.
  if (opts.needsOnboarding === false && existing.needsOnboarding) return false;
  if (opts.installationId != null && existing.installationId == null) return false;
  if (opts.githubRepoId != null && existing.githubRepoId == null) return false;
  // A rename that would propagate via the githubRepoId match path is not a noop.
  if (opts.githubRepoId != null && existing.githubRepoId === opts.githubRepoId) {
    if (input.name !== existing.name) return false;
    if (input.kind !== existing.kind) return false;
  }
  if (opts.source === "discovery") {
    const finalOwners =
      input.ownerTeamIds !== undefined
        ? (input.ownerTeamIds ?? [])
        : existing.owners.map((o) => o.teamId);
    if (existing.unowned !== (finalOwners.length === 0)) return false;
  }
  return true;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function normalizeRepoSlug(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
  return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null;
}

function isPlatformRepo(repoUrl: string | null): boolean {
  return PLATFORM_REPO !== null && normalizeRepoSlug(repoUrl) === PLATFORM_REPO;
}

// Ensures the platform's own entity carries the "platform" tag while preserving the source-driven tag
// set. tags here flow into create/patch/noop alike, so the marker stays consistent across syncs.
function applyPlatformTag(
  input: RegisterCatalogEntityInput,
  existing: { repoUrl: string | null; tags: string[] } | null,
): RegisterCatalogEntityInput {
  const repoUrl = input.repoUrl !== undefined ? input.repoUrl : (existing?.repoUrl ?? null);
  if (!isPlatformRepo(repoUrl)) return input;
  const base = input.tags ?? existing?.tags ?? [];
  if (base.includes(PLATFORM_TAG)) return input;
  return { ...input, tags: [...base, PLATFORM_TAG] };
}

export class CrossOrgOwnerError extends Error {
  constructor(
    readonly entityAccountLogin: string,
    readonly mismatchedTeamIds: string[],
  ) {
    super(
      `Owner teams must belong to org "${entityAccountLogin}"; mismatched: ${mismatchedTeamIds.join(", ")}`,
    );
    this.name = "CrossOrgOwnerError";
  }
}

async function assertOwnerTeamsMatchOrg(teamIds: string[], accountLogin: string): Promise<void> {
  if (teamIds.length === 0) return;
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, accountLogin: true },
  });
  const mismatched = teams.filter((t) => t.accountLogin !== accountLogin).map((t) => t.id);
  if (mismatched.length > 0) {
    throw new CrossOrgOwnerError(accountLogin, mismatched);
  }
}

async function resolveAccountLoginByInstallation(installationId: number): Promise<string | null> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github" },
    select: { config: true },
  });
  for (const row of rows) {
    const cfg = row.config as { installationId?: unknown; accountLogin?: unknown } | null;
    if (
      cfg &&
      Number(cfg.installationId) === installationId &&
      typeof cfg.accountLogin === "string" &&
      cfg.accountLogin.length > 0
    ) {
      return cfg.accountLogin;
    }
  }
  return null;
}

/** Mark every entity with `repoUrl != null` whose `lastSeenAt` is older than `since` as stale. */
export async function markStaleEntities(since: Date): Promise<number> {
  const result = await prisma.catalogEntity.updateMany({
    where: {
      repoUrl: { not: null },
      lastSeenAt: { lt: since },
      staleSince: null,
    },
    data: { staleSince: new Date() },
  });
  return result.count;
}
