// Org-level team sync driven by a GitHub App installation: snapshot GitHub, diff against the DB, apply the delta in one transaction, record the run.

import { Prisma, prisma, type UserKind, type UserRole } from "@internal/db";
import {
  GitHubAppNotConfiguredError,
  octokitForInstallation,
} from "@feature/integrations-backend/contract";
import type { Octokit as OctokitClient } from "octokit";

export type ReconciliationSource = "webhook" | "cron" | "manual" | "boot";

export interface ReconciliationResult {
  runId: string;
  installationId: number;
  source: ReconciliationSource;
  ok: boolean;
  skippedReason?: "user_account" | "no_org_login" | "app_not_configured";
  teamsCreated: number;
  teamsUpdated: number;
  teamsDeleted: number;
  membersAdded: number;
  membersRemoved: number;
  pendingQueued: number;
  pendingResolved: number;
  // UserOrgMembership rows for this org, distinct from per-team membersAdded/membersRemoved.
  orgMembershipsAdded: number;
  orgMembershipsRemoved: number;
  // CatalogEntityTeamGrant rows synced from GitHub team-repo permissions.
  grantsUpserted: number;
  grantsRemoved: number;
  errors: Array<{ scope: string; reason: string }>;
  startedAt: Date;
  finishedAt: Date;
}

interface GithubTeamRecord {
  nodeId: string; // stable across renames, used as Team.externalId
  databaseId: number;
  slug: string;
  name: string;
  description: string | null;
  parentNodeId: string | null;
  members: Array<{ githubId: string; login: string; role: "lead" | "member" }>;
}

export type GrantPermission = "admin" | "maintain" | "push" | "triage" | "pull";

interface RepoGrant {
  teamNodeId: string;
  repoGithubId: number;
  permission: GrantPermission;
}

interface GithubState {
  teams: GithubTeamRecord[];
  orgMemberIds: Set<string>; // githubIds, used to filter outside collaborators
  orgLogin: string;
  // Team to repo access grants, the source for CatalogEntityTeamGrant.
  repoGrants: RepoGrant[];
  // Team node_ids whose repo list was fetched cleanly this run. A team missing
  // here (transient 404 mid-pass) is left untouched rather than pruned to empty.
  reposFetchedTeamNodeIds: Set<string>;
}

const PERMISSION_RANK: Record<GrantPermission, number> = {
  pull: 0,
  triage: 1,
  push: 2,
  maintain: 3,
  admin: 4,
};

function derivePermission(perms: Record<string, boolean> | undefined): GrantPermission | null {
  if (!perms) return null;
  if (perms.admin) return "admin";
  if (perms.maintain) return "maintain";
  if (perms.push) return "push";
  if (perms.triage) return "triage";
  if (perms.pull) return "pull";
  return null;
}

interface DbTeamRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  externalId: string;
  externalSlug: string | null;
  parentTeamId: string | null;
  installationId: number | null;
  memberUserIds: Set<string>;
  pendingGithubIds: Set<string>;
}

interface DbState {
  teamsByExternalId: Map<string, DbTeamRecord>;
  userIdByGithubId: Map<string, string>;
  // role/kind drive the org reconcile filter: admins and agent-kind users stay out.
  userRoleById: Map<string, UserRole>;
  userKindById: Map<string, UserKind>;
  existingOrgMembershipUserIds: Set<string>;
  // slugs held by non-github, non-soft-deleted teams, used for collision checks.
  manualSlugs: Set<string>;
}

export interface ReconciliationDiff {
  teamsToCreate: GithubTeamRecord[];
  teamsToUpdate: Array<{ existing: DbTeamRecord; gh: GithubTeamRecord }>;
  teamsToSoftDelete: DbTeamRecord[];
  membershipsToAdd: Array<{
    teamExternalId: string;
    userId: string;
    role: "lead" | "member";
  }>;
  membershipsToRemove: Array<{ teamId: string; userId: string }>;
  pendingToQueue: Array<{
    teamExternalId: string;
    githubId: string;
    githubLogin: string;
    role: "lead" | "member";
  }>;
  orgMembershipsToAdd: Array<{ userId: string }>;
  orgMembershipsToRemove: Array<{ userId: string }>;
}

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function runReconciliation(
  installationId: number,
  source: ReconciliationSource,
): Promise<ReconciliationResult> {
  const startedAt = new Date();
  const run = await prisma.githubReconciliationRun.create({
    data: { source, installationId, startedAt },
  });

  const result: ReconciliationResult = {
    runId: run.id,
    installationId,
    source,
    ok: true,
    teamsCreated: 0,
    teamsUpdated: 0,
    teamsDeleted: 0,
    membersAdded: 0,
    membersRemoved: 0,
    pendingQueued: 0,
    pendingResolved: 0,
    orgMembershipsAdded: 0,
    orgMembershipsRemoved: 0,
    grantsUpserted: 0,
    grantsRemoved: 0,
    errors: [],
    startedAt,
    finishedAt: startedAt,
  };

  let octo: OctokitClient;
  try {
    octo = await octokitForInstallation(installationId);
  } catch (err) {
    if (err instanceof GitHubAppNotConfiguredError) {
      await closeRun(run.id, result, { ok: false, skippedReason: "app_not_configured" });
      return result;
    }
    throw err;
  }

  const orgLogin = await readInstallationOrgLogin(installationId);
  if (!orgLogin) {
    await closeRun(run.id, result, { ok: false, skippedReason: "no_org_login" });
    return result;
  }

  // Personal-account installations have no teams and 404 here, so skip cleanly.
  let github: GithubState;
  try {
    github = await fetchGithubState(octo, orgLogin);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      await closeRun(run.id, result, { ok: false, skippedReason: "user_account" });
      return result;
    }
    result.errors.push({ scope: "fetch", reason: errMessage(err) });
    await closeRun(run.id, result, { ok: false });
    return result;
  }

  const db = await loadDbState(installationId, orgLogin);
  const diff = computeDiff(github, db, installationId);
  const applied = await applyDiff(diff, db, github, installationId);

  result.teamsCreated = applied.teamsCreated;
  result.teamsUpdated = applied.teamsUpdated;
  result.teamsDeleted = applied.teamsDeleted;
  result.membersAdded = applied.membersAdded;
  result.membersRemoved = applied.membersRemoved;
  result.pendingQueued = applied.pendingQueued;
  result.orgMembershipsAdded = applied.orgMembershipsAdded;
  result.orgMembershipsRemoved = applied.orgMembershipsRemoved;
  result.errors.push(...applied.errors);

  // Sync GitHub team-repo grants after teams land so externalId resolves to a Team row.
  try {
    const grants = await reconcileRepoGrants(installationId, github);
    result.grantsUpserted = grants.grantsUpserted;
    result.grantsRemoved = grants.grantsRemoved;
  } catch (err) {
    result.errors.push({ scope: "repo-grants", reason: errMessage(err) });
  }

  // Revoke sessions for users who lost their last org coverage in this run, mirroring the admin-disconnect flow.
  if (applied.removedOrgMembershipUserIds.length > 0) {
    try {
      await revokeSessionsForStrandedUsers(applied.removedOrgMembershipUserIds);
    } catch (err) {
      result.errors.push({ scope: "stranded-sessions", reason: errMessage(err) });
    }
  }

  await closeRun(run.id, result, { ok: applied.errors.length === 0 && result.errors.length === 0 });
  return result;
}

async function revokeSessionsForStrandedUsers(candidateUserIds: string[]): Promise<void> {
  const remaining = await prisma.userOrgMembership.groupBy({
    by: ["userId"],
    where: { userId: { in: candidateUserIds } },
    _count: { userId: true },
  });
  const stillCovered = new Set(remaining.map((r) => r.userId));
  const stranded = candidateUserIds.filter((id) => !stillCovered.has(id));
  if (stranded.length === 0) return;
  await prisma.session.deleteMany({ where: { userId: { in: stranded } } });
}

async function readInstallationOrgLogin(installationId: number): Promise<string | null> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github" },
    select: { config: true },
  });
  for (const row of rows) {
    const cfg =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : null;
    if (!cfg) continue;
    if (cfg.installationId !== installationId) continue;
    if (cfg.accountType !== "Organization") return null;
    const login = typeof cfg.accountLogin === "string" ? cfg.accountLogin : null;
    return login && login.length > 0 ? login : null;
  }
  return null;
}

export async function fetchGithubState(
  octo: OctokitClient,
  orgLogin: string,
): Promise<GithubState> {
  type TeamApi = {
    id: number;
    node_id: string;
    slug: string;
    name: string;
    description: string | null;
    parent: { node_id: string } | null;
  };
  type MemberApi = { id: number; login: string };
  type RepoApi = { id: number; permissions?: Record<string, boolean> };

  const teamsRaw = (await octo.paginate(octo.rest.teams.list, {
    org: orgLogin,
    per_page: 100,
  })) as TeamApi[];

  const orgMembersRaw = (await octo.paginate(octo.rest.orgs.listMembers, {
    org: orgLogin,
    per_page: 100,
  })) as MemberApi[];
  const orgMemberIds = new Set(orgMembersRaw.map((m) => String(m.id)));

  const teams: GithubTeamRecord[] = [];
  const repoGrants: RepoGrant[] = [];
  const reposFetchedTeamNodeIds = new Set<string>();
  for (const t of teamsRaw) {
    let members: GithubTeamRecord["members"] = [];
    try {
      const maintainersRaw = (await octo.paginate(octo.rest.teams.listMembersInOrg, {
        org: orgLogin,
        team_slug: t.slug,
        role: "maintainer",
        per_page: 100,
      })) as MemberApi[];
      const allRaw = (await octo.paginate(octo.rest.teams.listMembersInOrg, {
        org: orgLogin,
        team_slug: t.slug,
        role: "all",
        per_page: 100,
      })) as MemberApi[];
      const maintainerIds = new Set(maintainersRaw.map((m) => String(m.id)));
      members = allRaw.map((m) => ({
        githubId: String(m.id),
        login: m.login,
        role: maintainerIds.has(String(m.id)) ? ("lead" as const) : ("member" as const),
      }));
    } catch (err) {
      // 404: team vanished between list and members fetch, treat as empty, diff handles it.
      if ((err as { status?: number }).status !== 404) throw err;
    }
    try {
      const reposRaw = (await octo.paginate(octo.rest.teams.listReposInOrg, {
        org: orgLogin,
        team_slug: t.slug,
        per_page: 100,
      })) as RepoApi[];
      for (const r of reposRaw) {
        const permission = derivePermission(r.permissions);
        if (permission) {
          repoGrants.push({ teamNodeId: t.node_id, repoGithubId: r.id, permission });
        }
      }
      // Mark success only after a clean pass so a transient 404 leaves grants intact.
      reposFetchedTeamNodeIds.add(t.node_id);
    } catch (err) {
      // 404: team vanished mid-pass, skip its repo grants, the reconcile diff handles removals.
      if ((err as { status?: number }).status !== 404) throw err;
    }
    teams.push({
      nodeId: t.node_id,
      databaseId: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      parentNodeId: t.parent?.node_id ?? null,
      members,
    });
  }

  return { teams, orgMemberIds, orgLogin, repoGrants, reposFetchedTeamNodeIds };
}

async function loadDbState(installationId: number, orgLogin: string): Promise<DbState> {
  // Scope by org, not installationId: an App reinstall changes the installationId but
  // teams keep their (source, externalId), so this still finds them and applyDiff re-keys them.
  const teams = await prisma.team.findMany({
    where: { source: "github", accountLogin: orgLogin },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      externalId: true,
      externalSlug: true,
      parentTeamId: true,
      installationId: true,
      memberships: { select: { userId: true } },
      pendingMemberships: { select: { githubId: true } },
    },
  });

  const teamsByExternalId = new Map<string, DbTeamRecord>();
  for (const t of teams) {
    if (!t.externalId) continue; // defensive, source=github rows always have one
    teamsByExternalId.set(t.externalId, {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      externalId: t.externalId,
      externalSlug: t.externalSlug,
      parentTeamId: t.parentTeamId,
      installationId: t.installationId,
      memberUserIds: new Set(t.memberships.map((m) => m.userId)),
      pendingGithubIds: new Set(t.pendingMemberships.map((p) => p.githubId)),
    });
  }

  const users = await prisma.user.findMany({
    where: { githubId: { not: "" } },
    select: { id: true, githubId: true, role: true, userKind: true },
    take: 5000,
  });
  if (users.length === 5000) {
    console.warn("[catalog] team-sync user reconciliation hit the 5000-row cap");
  }
  const userIdByGithubId = new Map(users.map((u) => [u.githubId, u.id]));
  const userRoleById = new Map(users.map((u) => [u.id, u.role]));
  const userKindById = new Map(users.map((u) => [u.id, u.userKind]));

  const orgRows = await prisma.userOrgMembership.findMany({
    where: { accountLogin: orgLogin },
    select: { userId: true },
    take: 5000,
  });
  if (orgRows.length === 5000) {
    console.warn("[catalog] team-sync org membership reconciliation hit the 5000-row cap");
  }
  const existingOrgMembershipUserIds = new Set(orgRows.map((r) => r.userId));

  const manual = await prisma.team.findMany({
    where: { source: { not: "github" }, deletedAt: null },
    select: { slug: true },
    take: 5000,
  });
  if (manual.length === 5000) {
    console.warn("[catalog] team-sync manual team reconciliation hit the 5000-row cap");
  }
  const manualSlugs = new Set(manual.map((t) => t.slug));

  return {
    teamsByExternalId,
    userIdByGithubId,
    userRoleById,
    userKindById,
    existingOrgMembershipUserIds,
    manualSlugs,
  };
}

export function computeDiff(
  github: GithubState,
  db: DbState,
  installationId: number,
): ReconciliationDiff {
  const diff: ReconciliationDiff = {
    teamsToCreate: [],
    teamsToUpdate: [],
    teamsToSoftDelete: [],
    membershipsToAdd: [],
    membershipsToRemove: [],
    pendingToQueue: [],
    orgMembershipsToAdd: [],
    orgMembershipsToRemove: [],
  };

  const seenExternalIds = new Set<string>();

  for (const gh of github.teams) {
    seenExternalIds.add(gh.nodeId);
    const existing = db.teamsByExternalId.get(gh.nodeId);
    if (!existing) {
      diff.teamsToCreate.push(gh);
    } else if (
      existing.name !== gh.name ||
      existing.description !== gh.description ||
      existing.externalSlug !== gh.slug ||
      existing.installationId !== installationId // re-key after an App reinstall
      // parent reconciled in second pass after creates land
    ) {
      diff.teamsToUpdate.push({ existing, gh });
    }

    // Unknown githubIds become pending entries rather than adds.
    const desiredUserIds = new Map<string, "lead" | "member">();
    for (const m of gh.members) {
      if (!github.orgMemberIds.has(m.githubId)) {
        continue; // outside collaborator, not tracked by policy
      }
      const userId = db.userIdByGithubId.get(m.githubId);
      if (userId) {
        desiredUserIds.set(userId, m.role);
      } else {
        diff.pendingToQueue.push({
          teamExternalId: gh.nodeId,
          githubId: m.githubId,
          githubLogin: m.login,
          role: m.role,
        });
      }
    }

    if (existing) {
      for (const [userId, role] of desiredUserIds) {
        if (!existing.memberUserIds.has(userId)) {
          diff.membershipsToAdd.push({
            teamExternalId: gh.nodeId,
            userId,
            role,
          });
        }
      }
      for (const userId of existing.memberUserIds) {
        if (!desiredUserIds.has(userId)) {
          diff.membershipsToRemove.push({ teamId: existing.id, userId });
        }
      }
    } else {
      // Brand-new team: every desired membership is an add, teamId resolved after the create lands.
      for (const [userId, role] of desiredUserIds) {
        diff.membershipsToAdd.push({
          teamExternalId: gh.nodeId,
          userId,
          role,
        });
      }
    }
  }

  // Teams in DB but no longer on GitHub get soft-deleted.
  for (const dbTeam of db.teamsByExternalId.values()) {
    if (!seenExternalIds.has(dbTeam.externalId)) {
      diff.teamsToSoftDelete.push(dbTeam);
    }
  }

  // Desired org members: known users active in the org, excluding admins and agent-kind users.
  const desiredOrgUserIds = new Set<string>();
  for (const githubId of github.orgMemberIds) {
    const userId = db.userIdByGithubId.get(githubId);
    if (!userId) continue;
    if (db.userRoleById.get(userId) === "admin") continue;
    if (db.userKindById.get(userId) !== "human") continue;
    desiredOrgUserIds.add(userId);
  }
  for (const userId of desiredOrgUserIds) {
    if (!db.existingOrgMembershipUserIds.has(userId)) {
      diff.orgMembershipsToAdd.push({ userId });
    }
  }
  for (const userId of db.existingOrgMembershipUserIds) {
    if (!desiredOrgUserIds.has(userId)) {
      diff.orgMembershipsToRemove.push({ userId });
    }
  }

  return diff;
}

interface ApplyResult {
  teamsCreated: number;
  teamsUpdated: number;
  teamsDeleted: number;
  membersAdded: number;
  membersRemoved: number;
  pendingQueued: number;
  orgMembershipsAdded: number;
  orgMembershipsRemoved: number;
  // userIds whose org row was deleted this run, used post-transaction to find stranded users.
  removedOrgMembershipUserIds: string[];
  errors: Array<{ scope: string; reason: string }>;
}

async function applyDiff(
  diff: ReconciliationDiff,
  db: DbState,
  github: GithubState,
  installationId: number,
): Promise<ApplyResult> {
  const out: ApplyResult = {
    teamsCreated: 0,
    teamsUpdated: 0,
    teamsDeleted: 0,
    membersAdded: 0,
    membersRemoved: 0,
    pendingQueued: 0,
    orgMembershipsAdded: 0,
    orgMembershipsRemoved: 0,
    removedOrgMembershipUserIds: [],
    errors: [],
  };

  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  await prisma.$transaction(async (tx) => {
    const createdByExternalId = new Map<string, string>(); // externalId to Team.id
    for (const gh of diff.teamsToCreate) {
      const slug = pickSlug(gh, db, github.orgLogin);
      const created = await tx.team.create({
        data: {
          slug,
          name: gh.name,
          description: gh.description,
          accountLogin: github.orgLogin,
          source: "github",
          externalId: gh.nodeId,
          externalSlug: gh.slug,
          installationId,
          lastSyncedAt: new Date(),
        },
        select: { id: true },
      });
      createdByExternalId.set(gh.nodeId, created.id);
      // Track the slug so subsequent picks in this run don't collide.
      db.manualSlugs.add(slug);
      out.teamsCreated++;
    }

    for (const { existing, gh } of diff.teamsToUpdate) {
      await tx.team.update({
        where: { id: existing.id },
        data: {
          name: gh.name,
          description: gh.description,
          externalSlug: gh.slug,
          installationId, // re-key onto the current installation after a reinstall
          lastSyncedAt: new Date(),
        },
      });
      out.teamsUpdated++;
    }

    for (const dbTeam of diff.teamsToSoftDelete) {
      await tx.team.update({
        where: { id: dbTeam.id },
        data: { deletedAt: new Date() },
      });
      out.teamsDeleted++;
    }

    const resolveTeamId = (externalId: string): string | null => {
      const existing = db.teamsByExternalId.get(externalId);
      if (existing) return existing.id;
      return createdByExternalId.get(externalId) ?? null;
    };

    // Parent links: process every snapshot team so re-parents and unparents both land.
    const softDeletedExternalIds = new Set(diff.teamsToSoftDelete.map((t) => t.externalId));
    for (const gh of github.teams) {
      if (softDeletedExternalIds.has(gh.nodeId)) continue;
      const teamId = resolveTeamId(gh.nodeId);
      if (!teamId) continue;
      const desiredParentId = gh.parentNodeId ? resolveTeamId(gh.parentNodeId) : null;
      const wasJustCreated = createdByExternalId.has(gh.nodeId);
      const currentParentId = wasJustCreated
        ? null
        : (db.teamsByExternalId.get(gh.nodeId)?.parentTeamId ?? null);
      if (currentParentId !== desiredParentId) {
        await tx.team.update({
          where: { id: teamId },
          data: { parentTeamId: desiredParentId },
        });
      }
    }

    // skipDuplicates guards against a concurrent transaction inserting the row first.
    if (diff.membershipsToAdd.length > 0) {
      const addRows = diff.membershipsToAdd
        .map((a) => {
          const teamId = resolveTeamId(a.teamExternalId);
          if (!teamId) return null;
          return { teamId, userId: a.userId, role: a.role };
        })
        .filter(
          (r): r is { teamId: string; userId: string; role: "lead" | "member" } => r !== null,
        );
      if (addRows.length > 0) {
        const inserted = await tx.teamMembership.createMany({
          data: addRows,
          skipDuplicates: true,
        });
        out.membersAdded += inserted.count;
      }
    }

    for (const r of diff.membershipsToRemove) {
      try {
        await tx.teamMembership.delete({
          where: { teamId_userId: { teamId: r.teamId, userId: r.userId } },
        });
        out.membersRemoved++;
      } catch (err) {
        // P2025: already removed by another path.
        if ((err as { code?: string }).code !== "P2025") throw err;
      }
    }

    // Upsert refreshes expiresAt so slow onboarding (>7d) doesn't drop a pending member.
    for (const p of diff.pendingToQueue) {
      const teamId = resolveTeamId(p.teamExternalId);
      if (!teamId) continue;
      await tx.pendingTeamMembership.upsert({
        where: { teamId_githubId: { teamId, githubId: p.githubId } },
        update: { githubLogin: p.githubLogin, role: p.role, expiresAt },
        create: {
          teamId,
          githubId: p.githubId,
          githubLogin: p.githubLogin,
          role: p.role,
          expiresAt,
        },
      });
      out.pendingQueued++;
    }

    // Removes are tracked so the caller can revoke sessions for newly-stranded users post-commit.
    if (diff.orgMembershipsToAdd.length > 0) {
      const addRows = diff.orgMembershipsToAdd.map((a) => ({
        userId: a.userId,
        accountLogin: github.orgLogin,
        lastVerifiedAt: new Date(),
      }));
      const inserted = await tx.userOrgMembership.createMany({
        data: addRows,
        skipDuplicates: true,
      });
      out.orgMembershipsAdded += inserted.count;
    }
    for (const r of diff.orgMembershipsToRemove) {
      try {
        await tx.userOrgMembership.delete({
          where: { userId_accountLogin: { userId: r.userId, accountLogin: github.orgLogin } },
        });
        out.orgMembershipsRemoved++;
        out.removedOrgMembershipUserIds.push(r.userId);
      } catch (err) {
        if ((err as { code?: string }).code !== "P2025") throw err;
      }
    }
  });

  return out;
}

// Mirror GitHub team-repo permissions into CatalogEntityTeamGrant. Runs after
// applyDiff so every snapshot team has a Team row to resolve its node_id against.
async function reconcileRepoGrants(
  installationId: number,
  github: GithubState,
): Promise<{ grantsUpserted: number; grantsRemoved: number }> {
  const repoGrants = github.repoGrants;
  const teams = await prisma.team.findMany({
    where: { installationId, source: "github", deletedAt: null, externalId: { not: null } },
    select: { id: true, externalId: true },
  });
  const teamIdByExternalId = new Map<string, string>();
  for (const t of teams) if (t.externalId) teamIdByExternalId.set(t.externalId, t.id);

  // Teams present in the snapshot but whose repo list didn't fetch cleanly this
  // run: their existing grants are left as-is rather than pruned to empty.
  const uncertainTeamIds = new Set<string>();
  for (const gh of github.teams) {
    if (github.reposFetchedTeamNodeIds.has(gh.nodeId)) continue;
    const teamId = teamIdByExternalId.get(gh.nodeId);
    if (teamId) uncertainTeamIds.add(teamId);
  }

  const repoIds = Array.from(new Set(repoGrants.map((g) => g.repoGithubId)));
  const entities = await prisma.catalogEntity.findMany({
    where: { installationId, githubRepoId: { in: repoIds.length > 0 ? repoIds : [-1] } },
    select: { id: true, githubRepoId: true },
  });
  const entityIdByRepoId = new Map<number, string>();
  for (const e of entities) if (e.githubRepoId != null) entityIdByRepoId.set(e.githubRepoId, e.id);

  // Strongest grant wins if a team somehow lands twice for one repo.
  const desired = new Map<
    string,
    { entityId: string; teamId: string; permission: GrantPermission }
  >();
  for (const g of repoGrants) {
    const teamId = teamIdByExternalId.get(g.teamNodeId);
    const entityId = entityIdByRepoId.get(g.repoGithubId);
    if (!teamId || !entityId) continue;
    const key = `${entityId}:${teamId}`;
    const prev = desired.get(key);
    if (!prev || PERMISSION_RANK[g.permission] > PERMISSION_RANK[prev.permission]) {
      desired.set(key, { entityId, teamId, permission: g.permission });
    }
  }

  // Scope existing rows by the installation's entities so dropped grants get pruned.
  const existing = await prisma.catalogEntityTeamGrant.findMany({
    where: { entity: { installationId } },
    select: { entityId: true, teamId: true, permission: true },
  });
  const existingMap = new Map(existing.map((e) => [`${e.entityId}:${e.teamId}`, e.permission]));

  let grantsUpserted = 0;
  let grantsRemoved = 0;
  await prisma.$transaction(async (tx) => {
    for (const [key, d] of desired) {
      if (existingMap.get(key) !== d.permission) {
        await tx.catalogEntityTeamGrant.upsert({
          where: { entityId_teamId: { entityId: d.entityId, teamId: d.teamId } },
          create: { entityId: d.entityId, teamId: d.teamId, permission: d.permission },
          update: { permission: d.permission },
        });
        grantsUpserted++;
      }
    }
    for (const e of existing) {
      // Keep grants for teams whose repos didn't fetch cleanly, only prune confirmed removals.
      if (uncertainTeamIds.has(e.teamId)) continue;
      if (!desired.has(`${e.entityId}:${e.teamId}`)) {
        try {
          await tx.catalogEntityTeamGrant.delete({
            where: { entityId_teamId: { entityId: e.entityId, teamId: e.teamId } },
          });
          grantsRemoved++;
        } catch (err) {
          // P2025: already removed by a concurrent reconciliation run.
          if ((err as { code?: string }).code !== "P2025") throw err;
        }
      }
    }
  });

  return { grantsUpserted, grantsRemoved };
}

function pickSlug(gh: GithubTeamRecord, db: DbState, orgLogin: string): string {
  const base = sanitizeSlug(gh.slug);
  if (!db.manualSlugs.has(base)) return base;
  const orgSuffix = sanitizeSlug(`${base}-${orgLogin}`);
  if (!db.manualSlugs.has(orgSuffix)) return orgSuffix;
  return sanitizeSlug(`${orgSuffix}-${shortHash(gh.nodeId)}`);
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function shortHash(input: string): string {
  // 6-char DJB2 hash, just a tiebreak suffix so crypto strength is not needed.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

async function closeRun(
  runId: string,
  result: ReconciliationResult,
  patch: { ok: boolean; skippedReason?: ReconciliationResult["skippedReason"] },
): Promise<void> {
  result.finishedAt = new Date();
  result.ok = patch.ok;
  if (patch.skippedReason) result.skippedReason = patch.skippedReason;
  await prisma.githubReconciliationRun.update({
    where: { id: runId },
    data: {
      finishedAt: result.finishedAt,
      teamsCreated: result.teamsCreated,
      teamsUpdated: result.teamsUpdated,
      teamsDeleted: result.teamsDeleted,
      membersAdded: result.membersAdded,
      membersRemoved: result.membersRemoved,
      pendingQueued: result.pendingQueued,
      pendingResolved: result.pendingResolved,
      orgMembershipsAdded: result.orgMembershipsAdded,
      orgMembershipsRemoved: result.orgMembershipsRemoved,
      errors:
        result.errors.length > 0 || patch.skippedReason
          ? ({
              items: result.errors,
              skippedReason: patch.skippedReason ?? null,
            } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
