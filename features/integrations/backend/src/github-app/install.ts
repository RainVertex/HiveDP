// Business logic for the GitHub App install lifecycle. The HTTP install /
// callback routes live in apps/api because they need session middleware and
// audit access — this module owns the side effects (Integration upsert,
// metadata fetch, sync trigger seam) that those routes call into.

import { prisma } from "@internal/db";
import { octokitAsApp } from "./octokit";
import { disableStrandedUsers } from "./uninstall-effects";

export interface InstallationMetadata {
  installationId: number;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositorySelection: "all" | "selected";
}

/** Read installation metadata from GitHub using App-level (non-installation) auth. */
export async function fetchInstallationMetadata(
  installationId: number,
): Promise<InstallationMetadata> {
  const octo = await octokitAsApp();
  const res = await octo.rest.apps.getInstallation({ installation_id: installationId });
  const data = res.data as {
    id: number;
    account: { login?: string; type?: string } | null;
    repository_selection: "all" | "selected";
  };
  const account = data.account ?? {};
  return {
    installationId: data.id,
    accountLogin: account.login ?? "",
    accountType: account.type === "User" ? "User" : "Organization",
    repositorySelection: data.repository_selection,
  };
}

export interface RecordInstallationResult {
  integrationId: string;
  created: boolean;
  meta: InstallationMetadata;
}

/** Upsert an Integration row for a GitHub App installation. */
export async function recordInstallation(
  installationId: number,
): Promise<RecordInstallationResult> {
  const meta = await fetchInstallationMetadata(installationId);
  const config = {
    installationId: meta.installationId,
    accountLogin: meta.accountLogin,
    accountType: meta.accountType,
    repositorySelection: meta.repositorySelection,
    syncedAt: null,
  };

  const existing = await findExistingByInstallationId(installationId);
  if (existing) {
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: {
        // Re-enable on re-install; account or repositorySelection may also change.
        enabled: true,
        config,
      },
    });
    return { integrationId: updated.id, created: false, meta };
  }

  const created = await prisma.integration.create({
    data: {
      name: `GitHub: ${meta.accountLogin}`,
      description: `${meta.accountType} ${meta.accountLogin} via GitHub App (${meta.repositorySelection} repos)`,
      kind: "github",
      enabled: true,
      config,
    },
  });
  return { integrationId: created.id, created: true, meta };
}

/** Disable the Integration when the App is uninstalled via GitHub's UI (installation.deleted */
export async function recordUninstallation(installationId: number): Promise<{
  integrationId: string | null;
  entitiesStaled: number;
}> {
  const existing = await findExistingByInstallationId(installationId);
  const cascade = await cascadeStaleByInstallationId(installationId);
  if (!existing) return { integrationId: null, entitiesStaled: cascade.count };
  await prisma.integration.update({
    where: { id: existing.id },
    data: { enabled: false },
  });
  return { integrationId: existing.id, entitiesStaled: cascade.count };
}

/** Mark every CatalogEntity tied to an installation as stale. */
export async function cascadeStaleByInstallationId(
  installationId: number,
): Promise<{ count: number }> {
  const result = await prisma.catalogEntity.updateMany({
    where: { installationId, staleSince: null },
    data: { staleSince: new Date() },
  });
  return { count: result.count };
}

/** Revoke the App on GitHub so it stops sending webhooks. */
export async function revokeAppInstallation(
  installationId: number,
): Promise<{ revoked: boolean; reason?: string }> {
  try {
    const octo = await octokitAsApp();
    await octo.rest.apps.deleteInstallation({ installation_id: installationId });
    return { revoked: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { revoked: true, reason: "installation already revoked on GitHub" };
    }
    return { revoked: false, reason: (err as Error).message };
  }
}

export interface DisconnectResult {
  installationId: number | null;
  accountLogin: string;
  entitiesStaled: number;
  revoked: boolean;
  revokeReason?: string;
  disabledUserIds: string[];
}

/** End-to-end disconnect: cascade-stale entities, revoke the App on GitHub, */
/** disable users whose only org was this one, then delete the Integration row. */
export async function disconnectGitHubInstallation(
  integrationId: string,
): Promise<DisconnectResult> {
  const integ = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, kind: true, config: true },
  });
  if (!integ) {
    throw new Error(`Integration ${integrationId} not found`);
  }
  if (integ.kind !== "github") {
    throw new Error(`Integration ${integrationId} is not a github integration`);
  }

  const cfg =
    integ.config && typeof integ.config === "object" && !Array.isArray(integ.config)
      ? (integ.config as Record<string, unknown>)
      : {};
  const installationIdRaw = Number(cfg.installationId);
  const installationId = Number.isFinite(installationIdRaw) ? installationIdRaw : null;
  const accountLogin = typeof cfg.accountLogin === "string" ? cfg.accountLogin : "";

  let entitiesStaled = 0;
  let revoked = false;
  let revokeReason: string | undefined;

  if (installationId != null) {
    const cascade = await cascadeStaleByInstallationId(installationId);
    entitiesStaled = cascade.count;
    const revoke = await revokeAppInstallation(installationId);
    revoked = revoke.revoked;
    revokeReason = revoke.reason;
  } else {
    revokeReason = "no installationId in config";
  }

  const { disabledUserIds } = await disableStrandedUsers(accountLogin);

  await prisma.integration.delete({ where: { id: integ.id } });
  return { installationId, accountLogin, entitiesStaled, revoked, revokeReason, disabledUserIds };
}

async function findExistingByInstallationId(installationId: number) {
  // Integration.config is JSON; Postgres can index/query JSON paths but the
  // existing Integration table has no GIN index. Filtering by kind first
  // narrows the candidates to a handful — fine to scan in JS.
  const rows = await prisma.integration.findMany({
    where: { kind: "github" },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    if (
      row.config &&
      typeof row.config === "object" &&
      !Array.isArray(row.config) &&
      (row.config as Record<string, unknown>).installationId === installationId
    ) {
      return row;
    }
  }
  return null;
}
