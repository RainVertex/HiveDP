// Octokit factories for GitHub App auth: as-app (install callback) and as-installation.

import type { Octokit as OctokitClient } from "octokit";
import { prisma } from "@internal/db";
import { loadGitHubAppConfig } from "./config";

// `octokit` v5 is ESM-only and the api backend is CJS; defer the import so module load survives the CJS loader.
async function loadOctokit(): Promise<typeof OctokitClient> {
  const mod = await import("octokit");
  return mod.Octokit;
}

async function loadAuthAppStrategy() {
  const mod = await import("@octokit/auth-app");
  return mod.createAppAuth;
}

export class GitHubAppNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`GitHub App is not configured. Missing env vars: ${missing.join(", ")}`);
    this.name = "GitHubAppNotConfiguredError";
  }
}

export async function octokitAsApp(): Promise<OctokitClient> {
  const cfg = loadGitHubAppConfig();
  if (!cfg.ok) throw new GitHubAppNotConfiguredError(cfg.missing);
  const Octokit = await loadOctokit();
  const createAppAuth = await loadAuthAppStrategy();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    },
  });
}

// Plain personal-access-token client, used as a fallback when no GitHub App installation
// covers the target owner (e.g. a public repo or a self-host fork pointing at its own source).
export async function octokitForToken(token: string): Promise<OctokitClient> {
  const Octokit = await loadOctokit();
  return new Octokit({ auth: token });
}

export async function octokitForInstallation(installationId: number): Promise<OctokitClient> {
  const cfg = loadGitHubAppConfig();
  if (!cfg.ok) throw new GitHubAppNotConfiguredError(cfg.missing);
  const Octokit = await loadOctokit();
  const createAppAuth = await loadAuthAppStrategy();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      installationId,
    },
  });
}

// Mints a short-lived installation access token (ghs_..., ~1h TTL) for git operations: it is embedded
// in the clone/push remote URL so a sandbox can read and write the repo without ever holding the App
// private key. The token is scoped to the single installation and expires on its own.
export async function installationGitToken(installationId: number): Promise<string> {
  const octo = await octokitAsApp();
  const res = await octo.rest.apps.createInstallationAccessToken({
    installation_id: installationId,
  });
  return res.data.token;
}

// Resolves the GitHub App installation id for an org/user login from the stored Integration rows
// (accountLogin + installationId live in plaintext config, only secrets are encrypted).
export async function installationIdForLogin(login: string): Promise<number | null> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { config: true },
  });
  for (const row of rows) {
    const cfg = row.config;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const record = cfg as Record<string, unknown>;
    if (record.accountLogin !== login) continue;
    const id =
      typeof record.installationId === "number"
        ? record.installationId
        : Number(record.installationId);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  return null;
}

// Installation-scoped Octokit for the org/user that owns a target repo, or null if the App
// is not installed there. Commits made with this client are attributed to the App bot.
export async function octokitForLogin(login: string): Promise<OctokitClient | null> {
  const installationId = await installationIdForLogin(login);
  if (installationId == null) return null;
  return octokitForInstallation(installationId);
}
