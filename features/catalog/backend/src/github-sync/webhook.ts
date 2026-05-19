// GitHub App webhook receiver. The App is configured with ONE webhook URL
// (this one); all event types — installation, repository, push,
// installation_repositories, etc. — funnel here. We verify the App-wide HMAC
// secret, then dispatch by `x-github-event`.
//
// Lives in catalog-backend (not integrations-backend) so it can call into the
// sync orchestrator + stale helpers without creating a cycle. The HMAC
// verifier and recordInstallation/Uninstallation business logic stay in
// integrations-backend; we import them here.
//
// IMPORTANT: this router applies its own express.raw() middleware. It MUST be
// mounted in createServer.ts BEFORE express.json() consumes the body, since
// HMAC verification needs the exact byte stream GitHub signed.

import express, { Router, type Request, type Response } from "express";
import { prisma } from "@internal/db";
import {
  disableStrandedUsers,
  GitHubAppNotConfiguredError,
  loadGitHubAppConfig,
  octokitForInstallation,
  recordInstallation,
  recordUninstallation,
  verifyGitHubSignature,
} from "@feature/integrations-backend";
import {
  syncInstallation,
  syncRepoByName,
  staleEntitiesForInstallation,
  staleEntityByGithubRepoId,
} from "./bulk-sync";
import { runReconciliation } from "./team-sync";
import { upsertWorkflowRun, upsertDeployment } from "../pipelines/upsert";
import type { Octokit as OctokitClient } from "octokit";

export const githubAppWebhookRouter: Router = Router();

githubAppWebhookRouter.post(
  "/",
  express.raw({ type: "*/*", limit: "5mb" }),
  async (req: Request, res: Response) => {
    const cfg = loadGitHubAppConfig();
    if (!cfg.ok) {
      res.status(503).json({ error: "GitHub App not configured", missing: cfg.missing });
      return;
    }

    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      res.status(400).json({ error: "raw body required" });
      return;
    }

    const sig = req.header("x-hub-signature-256");
    if (!verifyGitHubSignature(cfg.webhookSecret, raw, sig)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const event = req.header("x-github-event") ?? "";
    const deliveryId = req.header("x-github-delivery") ?? null;

    if (event === "ping") {
      res.json({ ok: true, pong: true });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "invalid json body" });
      return;
    }

    // Ack fast — GitHub fails deliveries that take >10s. Heavy work runs
    // in the background; errors are logged via the .catch() below.
    res.status(202).json({ accepted: true, event, deliveryId });

    void dispatch(event, payload).catch((err: unknown) => {
      console.error("[github-app webhook] dispatch failed", {
        event,
        deliveryId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  },
);

async function dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
  const action = typeof payload.action === "string" ? payload.action : "";

  if (event === "installation") {
    await handleInstallation(action, payload);
    return;
  }
  if (event === "installation_repositories") {
    await handleInstallationRepositories(action, payload);
    return;
  }
  if (event === "repository") {
    await handleRepository(action, payload);
    return;
  }
  if (event === "push") {
    await handlePush(payload);
    return;
  }
  // Team / membership / organization events all converge on a single
  // differential reconciliation. The diff is computed from current GitHub +
  // DB state, so it doesn't matter which event fired — we always end at
  // the right end state. Idempotent under concurrent webhook delivery.
  if (event === "team" || event === "membership" || event === "organization") {
    await handleOrgReconciliation(event, action, payload);
    return;
  }
  // Pipeline visibility — CI/CD runs and deployments. The handlers tolerate
  // unknown repos (catalog entity not yet imported) by no-op'ing; per-event
  // errors are swallowed so a bad payload can't poison the dispatcher.
  if (event === "workflow_run") {
    try {
      await upsertWorkflowRun(payload);
    } catch (err) {
      console.error("[github-app webhook] upsertWorkflowRun failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (event === "deployment" || event === "deployment_status") {
    try {
      await upsertDeployment(payload);
    } catch (err) {
      console.error("[github-app webhook] upsertDeployment failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  // Other events (pull_request, etc.) ignored for now.
}

async function handleInstallation(action: string, payload: Record<string, unknown>): Promise<void> {
  const installationId = readInstallationId(payload);
  if (installationId == null) return;

  if (action === "created") {
    await recordInstallation(installationId);
    // Bulk sync runs in the background; the webhook ack already returned.
    void syncInstallation(installationId).catch((err: unknown) => {
      console.error("[github-app webhook] bulk sync after install failed", {
        installationId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }

  if (action === "deleted") {
    const result = await recordUninstallation(installationId);
    await staleEntitiesForInstallation(installationId);

    // Disable any users whose only org coverage was this one and kill their
    // sessions, mirroring the admin-side disconnect flow.
    const accountLogin = readAccountLogin(payload);
    const { disabledUserIds } = await disableStrandedUsers(accountLogin);

    if (result.integrationId) {
      await prisma.auditEvent.create({
        data: {
          actorUserId: null,
          actorIp: null,
          requestId: null,
          kind: "integration.disconnected",
          targetKind: "integration",
          targetId: result.integrationId,
          payload: {
            integrationId: result.integrationId,
            kind: "github",
            accountLogin,
            disabledUserCount: disabledUserIds.length,
            source: "github_webhook",
          },
        },
      });
    }
    return;
  }

  // "suspend" and "unsuspend" leave the installation in place but pause/resume
  // event delivery. We mirror the catalog state by stale/un-staling — a
  // suspend acts like a soft uninstall.
  if (action === "suspend") {
    await staleEntitiesForInstallation(installationId);
    return;
  }
  if (action === "unsuspend") {
    void syncInstallation(installationId).catch(() => {});
    return;
  }
}

async function handleInstallationRepositories(
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const installationId = readInstallationId(payload);
  if (installationId == null) return;

  if (action === "added") {
    const added = readRepoList(payload.repositories_added);
    if (added.length === 0) return;
    let octo: OctokitClient;
    try {
      octo = await octokitForInstallation(installationId);
    } catch (err) {
      if (err instanceof GitHubAppNotConfiguredError) return;
      throw err;
    }
    for (const r of added) {
      const [owner, name] = r.full_name.split("/");
      if (!owner || !name) continue;
      try {
        await syncRepoByName(octo, owner, name, installationId);
      } catch {
        // Per-repo failure shouldn't block the whole webhook batch.
      }
    }
    return;
  }

  if (action === "removed") {
    const removed = readRepoList(payload.repositories_removed);
    for (const r of removed) {
      await staleEntityByGithubRepoId(r.id);
    }
    return;
  }
}

async function handleRepository(action: string, payload: Record<string, unknown>): Promise<void> {
  const installationId = readInstallationId(payload);
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!repo || typeof repo !== "object") return;
  const repoId = typeof repo.id === "number" ? repo.id : null;

  if (action === "deleted" || action === "transferred") {
    if (repoId != null) await staleEntityByGithubRepoId(repoId);
    return;
  }

  if (action === "archived") {
    if (repoId != null) await staleEntityByGithubRepoId(repoId);
    return;
  }

  if (
    action === "unarchived" ||
    action === "renamed" ||
    action === "created" ||
    action === "edited"
  ) {
    if (installationId == null) return;
    const fullName = typeof repo.full_name === "string" ? repo.full_name : null;
    if (!fullName) return;
    const [owner, name] = fullName.split("/");
    if (!owner || !name) return;
    let octo: OctokitClient;
    try {
      octo = await octokitForInstallation(installationId);
    } catch (err) {
      if (err instanceof GitHubAppNotConfiguredError) return;
      throw err;
    }
    await syncRepoByName(octo, owner, name, installationId);
    return;
  }
}

async function handlePush(payload: Record<string, unknown>): Promise<void> {
  const installationId = readInstallationId(payload);
  if (installationId == null) return;

  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!repo) return;
  const fullName = typeof repo.full_name === "string" ? repo.full_name : null;
  const defaultBranch = typeof repo.default_branch === "string" ? repo.default_branch : null;
  const ref = typeof payload.ref === "string" ? payload.ref : null;
  if (!fullName || !defaultBranch || !ref) return;

  // Only act on pushes to the default branch. Feature-branch pushes don't
  // change the catalog-info.yaml the platform considers authoritative.
  if (ref !== `refs/heads/${defaultBranch}`) return;

  // Consider only pushes that actually touch catalog-info.yaml or CODEOWNERS.
  // GitHub gives us per-commit added/modified/removed arrays; the union of
  // all of them is what we need to inspect.
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const touchedPaths = new Set<string>();
  for (const c of commits) {
    if (!c || typeof c !== "object") continue;
    for (const k of ["added", "modified", "removed"] as const) {
      const list = (c as Record<string, unknown>)[k];
      if (Array.isArray(list)) {
        for (const p of list) {
          if (typeof p === "string") touchedPaths.add(p);
        }
      }
    }
  }
  const relevantPaths = [
    "catalog-info.yaml",
    "catalog-info.yml",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    "docs/CODEOWNERS",
  ];
  const touchesRelevant = relevantPaths.some((p) => touchedPaths.has(p));
  if (!touchesRelevant) return;

  const [owner, name] = fullName.split("/");
  if (!owner || !name) return;
  let octo: OctokitClient;
  try {
    octo = await octokitForInstallation(installationId);
  } catch (err) {
    if (err instanceof GitHubAppNotConfiguredError) return;
    throw err;
  }
  await syncRepoByName(octo, owner, name, installationId);
}

// Subset of `team` / `membership` / `organization` actions we care about.
// For everything else we skip — notably `team.added_to_repository` and
// `team.removed_from_repository`, which don't change membership/structure.
const RELEVANT_TEAM_ACTIONS = new Set(["created", "deleted", "edited"]);
const RELEVANT_MEMBERSHIP_ACTIONS = new Set(["added", "removed"]);
const RELEVANT_ORG_ACTIONS = new Set(["member_added", "member_removed", "member_invited"]);

async function handleOrgReconciliation(
  event: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (event === "team" && !RELEVANT_TEAM_ACTIONS.has(action)) return;
  if (event === "membership" && !RELEVANT_MEMBERSHIP_ACTIONS.has(action)) return;
  if (event === "organization" && !RELEVANT_ORG_ACTIONS.has(action)) return;

  // `team` and `membership` events carry the installation; `organization`
  // events do too, when delivered to a GitHub App.
  const installationId = readInstallationId(payload);
  if (installationId == null) return;

  await runReconciliation(installationId, "webhook");
}

function readInstallationId(payload: Record<string, unknown>): number | null {
  const inst = payload.installation as Record<string, unknown> | undefined;
  if (!inst || typeof inst !== "object") return null;
  const id = inst.id;
  return typeof id === "number" ? id : null;
}

function readAccountLogin(payload: Record<string, unknown>): string {
  const inst = payload.installation as Record<string, unknown> | undefined;
  if (!inst || typeof inst !== "object") return "";
  const account = inst.account as Record<string, unknown> | undefined;
  if (!account || typeof account !== "object") return "";
  const login = account.login;
  return typeof login === "string" ? login : "";
}

function readRepoList(value: unknown): Array<{ id: number; full_name: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ id: number; full_name: string }> = [];
  for (const r of value) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    if (typeof obj.id === "number" && typeof obj.full_name === "string") {
      out.push({ id: obj.id, full_name: obj.full_name });
    }
  }
  return out;
}
