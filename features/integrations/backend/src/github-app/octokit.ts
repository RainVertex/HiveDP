// Octokit factories for GitHub App auth: as-app (install callback) and as-installation.

import type { Octokit as OctokitClient } from "octokit";
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
