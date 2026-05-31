// Side effects for the GitHub App install lifecycle (Integration upsert, metadata fetch, sync seam).

import { Prisma, prisma } from "@internal/db";
import { octokitAsApp } from "./octokit";
import { revokeStrandedUserSessions } from "./uninstall-effects";

export interface InstallationMetadata {
  installationId: number;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositorySelection: "all" | "selected";
}

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

export async function cascadeStaleByInstallationId(
  installationId: number,
): Promise<{ count: number }> {
  const result = await prisma.catalogEntity.updateMany({
    where: { installationId, staleSince: null },
    data: { staleSince: new Date() },
  });
  return { count: result.count };
}

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
  affectedUserIds: string[];
}

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

  const { affectedUserIds } = await revokeStrandedUserSessions(accountLogin);

  // Concurrent disconnect can race the row away; swallow P2025 so the caller still gets a clean result.
  try {
    await prisma.integration.delete({ where: { id: integ.id } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2025") {
      throw err;
    }
  }
  return { installationId, accountLogin, entitiesStaled, revoked, revokeReason, affectedUserIds };
}

async function findExistingByInstallationId(installationId: number) {
  // Integration.config JSON has no GIN index; filter by kind then scan in JS.
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
