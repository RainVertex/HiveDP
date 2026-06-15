import { prisma } from "@internal/db";
import { getSetting } from "@internal/llm-core";
import { octokitForInstallation } from "@feature/integrations-backend/contract";

// Resolves the configured platform source repo and a GitHub client for it.
// Repo coordinates live in the SystemSetting "chat.sourceRepo" so an admin (or a fork operator)
// can repoint the assistant at a different repository without a code change.

export const SOURCE_REPO_SETTING_KEY = "chat.sourceRepo";

export interface SourceRepoConfig {
  owner: string;
  repo: string;
  ref: string | null;
}

export async function getSourceRepoConfig(): Promise<SourceRepoConfig | null> {
  const raw = await getSetting<{ owner?: unknown; repo?: unknown; ref?: unknown }>(
    SOURCE_REPO_SETTING_KEY,
  );
  if (!raw || typeof raw.owner !== "string" || typeof raw.repo !== "string") return null;
  if (!raw.owner || !raw.repo) return null;
  return {
    owner: raw.owner,
    repo: raw.repo,
    ref: typeof raw.ref === "string" && raw.ref ? raw.ref : null,
  };
}

// Maps an org/user login to the numeric GitHub App installation id by scanning the kind=github
// Integration rows (their config JSON has no queryable index, so we filter then scan in JS).
export async function installationIdForOwner(owner: string): Promise<number | null> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { config: true },
  });
  const target = owner.toLowerCase();
  for (const row of rows) {
    const cfg = row.config;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const c = cfg as Record<string, unknown>;
    const login = typeof c.accountLogin === "string" ? c.accountLogin.toLowerCase() : "";
    if (login !== target) continue;
    const id = Number(c.installationId);
    if (Number.isFinite(id)) return id;
  }
  return null;
}

export interface SourceRepoToolError {
  error: string;
  code: "not_configured" | "no_credentials";
}

// Returns a ready GitHub client plus repo coordinates, or a structured error the model can relay.
// Uses the GitHub App installation for the owner.
export async function loadSourceRepoClient() {
  const cfg = await getSourceRepoConfig();
  if (!cfg) {
    return {
      error:
        "The platform source repository is not configured. An admin must set it in Admin -> AI / Models.",
      code: "not_configured" as const,
    };
  }
  const installationId = await installationIdForOwner(cfg.owner);
  if (installationId != null) {
    try {
      const octo = await octokitForInstallation(installationId);
      return { octo, owner: cfg.owner, repo: cfg.repo, ref: cfg.ref };
    } catch {
      // octokitForInstallation throws only when the GitHub App env is missing.
    }
  }
  return {
    error: `No GitHub App installation for ${cfg.owner}. Install the GitHub App on ${cfg.owner} to enable this.`,
    code: "no_credentials" as const,
  };
}
