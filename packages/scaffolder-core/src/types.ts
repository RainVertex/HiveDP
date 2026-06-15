/** Capability is a closed TS union. */
export type Capability =
  | "fs:write"
  | "db:write"
  | "db:write:catalog"
  | "repo:read"
  | "network:external"
  | "repo:public"
  | "repo:private"
  | `secrets:read:${string}`;

export type ActorKind = "human" | "agent" | "external-agent";

export type Audience = "human" | "agent";

// Every apply runs in an isolated worktree, outputs leave via publish actions only.
export type SandboxTarget = "worktree";

export type PlanMode = "create" | "update" | "no-op";

// Port-style trigger operation: CREATE provisions, DAY-2 mutates and DELETE tears down an existing entity.
export type TemplateOperation = "create" | "day2" | "delete";

export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface Actor {
  kind: ActorKind;
  userId: string;
  agentId?: string;
  teamIds: string[];
}

export interface UnifiedDiff {
  before: string | null;
  after: string | null;
  patch: string;
}

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Mutation =
  | {
      kind: "fs.write";
      path: string;
      contentDiff: UnifiedDiff;
      mode?: number;
    }
  | { kind: "fs.delete"; path: string; previousHash: string }
  | { kind: "fs.rename"; from: string; to: string }
  | { kind: "db.upsert"; model: string; where: Json; data: Json }
  | { kind: "catalog.register"; entity: CatalogEntityDraft }
  | {
      kind: "github.createRepo";
      org: string;
      name: string;
      visibility: "public" | "private";
    }
  | {
      kind: "github.push";
      remoteUrl: string;
      branch: string;
      fileCount: number;
    }
  | {
      kind: "github.openPr";
      repo: string;
      branch: string;
      base: string;
      title: string;
    }
  | { kind: "debug.log"; message: string };

export interface CatalogEntityDraft {
  kind: "service" | "api" | "library" | "website" | "database" | "infrastructure";
  name: string;
  description?: string | null;
  ownerTeamId?: string | null;
  repoUrl?: string | null;
  tags?: string[];
}

export type MatchResult = "absent" | "match" | "drift";

export interface PlanStep {
  stepId: string;
  action: string;
  capabilities: Capability[];
  mutations: Mutation[];
  reversible: boolean;
  matched: MatchResult;
}

export interface Plan {
  id: string;
  templateId: string;
  templateVersion: string;
  templateContentHash: string;
  params: Record<string, unknown>;
  paramsHash: string;
  bindingId: string | null;
  mode: PlanMode;
  createdAt: string;
  expiresAt: string;
  target: SandboxTarget;
  capabilities: Capability[];
  irreversible: boolean;
  steps: PlanStep[];
  actor: Actor;
}

export interface Binding {
  id: string;
  templateId: string;
  templateVersion: string;
  templateHash: string;
  paramsHash: string;
  params: Record<string, unknown>;
  targetKind: "repo" | "feature-dir" | "catalog";
  targetRef: string;
  target: SandboxTarget;
  branchName: string | null;
  prUrl: string | null;
  ownerTeamId: string | null;
  catalogEntityId: string | null;
  active: boolean;
  appliedByUserId: string;
  appliedAt: string;
  updatedAt: string;
}

export interface TeamSummary {
  id: string;
  slug: string;
  name: string;
}

export interface UserSummary {
  id: string;
  displayName: string;
  email: string;
}
