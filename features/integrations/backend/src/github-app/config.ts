// Loads GitHub App credentials from env (never the database), returning missing keys if unset.
// Adding new App permissions requires installations to accept the upgrade before those APIs work.

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  slug: string;
}

export interface PartialGitHubAppConfig {
  ok: false;
  missing: string[];
}

export type GitHubAppConfigResult = ({ ok: true } & GitHubAppConfig) | PartialGitHubAppConfig;

const ENV_KEYS = {
  appId: "GITHUB_APP_ID",
  privateKey: "GITHUB_APP_PRIVATE_KEY",
  clientId: "GITHUB_APP_CLIENT_ID",
  clientSecret: "GITHUB_APP_CLIENT_SECRET",
  webhookSecret: "GITHUB_APP_WEBHOOK_SECRET",
  slug: "GITHUB_APP_SLUG",
} as const;

export function loadGitHubAppConfig(): GitHubAppConfigResult {
  const missing: string[] = [];
  const values: Record<keyof GitHubAppConfig, string> = {
    appId: "",
    privateKey: "",
    clientId: "",
    clientSecret: "",
    webhookSecret: "",
    slug: "",
  };
  for (const [k, envKey] of Object.entries(ENV_KEYS) as Array<[keyof GitHubAppConfig, string]>) {
    const v = process.env[envKey];
    if (!v) {
      missing.push(envKey);
    } else {
      // .env files store PEM keys with escaped \n, restore real newlines.
      values[k] = k === "privateKey" ? v.replace(/\\n/g, "\n") : v;
    }
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, ...values };
}

export function isAppConfigured(): boolean {
  return loadGitHubAppConfig().ok;
}
