// Wire shapes for the scaffolder: templates, plans, tasks, bindings, and drift reports.
import type { ID, ISODateString } from "./common";
import type { CatalogEntity } from "./catalog";
import type { UserRole } from "./user";

export type ScaffolderCapability =
  | "fs:write"
  | "db:write"
  | "network:external"
  | "repo:public"
  | "repo:private"
  | `secrets:read:${string}`;

export type ScaffolderActorKind = "human" | "agent" | "external-agent";

export type ScaffolderTarget = "worktree";

export type ScaffolderOperation = "create" | "day2" | "delete";

export type ScaffolderPlanMode = "create" | "update" | "no-op";

export type ScaffolderTaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolled_back";

export type ScaffolderDriftStatus = "open" | "ignored" | "applied" | "superseded";

export interface ScaffolderTemplateSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
  icon?: string | null;
  audience: Array<"human" | "agent">;
  requiredRole: UserRole;
  capabilities: ScaffolderCapability[];
  operation: ScaffolderOperation;
}

// Resolved wizard state after evaluating jqQuery dynamic fields server-side.
export interface ScaffolderFormState {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
}

export interface ScaffolderTemplateDefRow {
  id: ID;
  identifier: string;
  // Backstage-style template.yaml source text.
  source: string;
  enabled: boolean;
  createdByUserId: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Editor preview: resolved form plus the validated identity of the draft template.yaml.
export interface ScaffolderTemplateDefPreview extends ScaffolderFormState {
  identifier: string;
  title: string;
  description: string;
  type: string | null;
}

// Installed action documentation, the Backstage /create/actions equivalent.
export interface ScaffolderActionDoc {
  id: string;
  description: string;
  capabilities: ScaffolderCapability[];
  irreversible: boolean;
  inputJsonSchema: Record<string, unknown>;
}

export interface ScaffolderUnifiedDiff {
  before: string | null;
  after: string | null;
  patch: string;
}

export type ScaffolderMutation =
  | { kind: "fs.write"; path: string; contentDiff: ScaffolderUnifiedDiff; mode?: number }
  | { kind: "fs.delete"; path: string; previousHash: string }
  | { kind: "fs.rename"; from: string; to: string }
  | { kind: "db.upsert"; model: string; where: unknown; data: unknown }
  | { kind: "catalog.register"; entity: Partial<CatalogEntity> }
  | {
      kind: "github.createRepo";
      org: string;
      name: string;
      visibility: "public" | "private";
    }
  | { kind: "github.push"; remoteUrl: string; branch: string; fileCount: number }
  | { kind: "github.openPr"; repo: string; branch: string; base: string; title: string }
  | { kind: "debug.log"; message: string };

export interface ScaffolderPlanStep {
  stepId: string;
  action: string;
  capabilities: ScaffolderCapability[];
  mutations: ScaffolderMutation[];
  reversible: boolean;
  matched: "absent" | "match" | "drift";
}

export interface ScaffolderPlan {
  id: ID;
  templateId: string;
  templateVersion: string;
  templateContentHash: string;
  params: Record<string, unknown>;
  paramsHash: string;
  bindingId: ID | null;
  mode: ScaffolderPlanMode;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  target: ScaffolderTarget;
  capabilities: ScaffolderCapability[];
  irreversible: boolean;
  steps: ScaffolderPlanStep[];
}

export interface ScaffolderTaskStepRow {
  id: ID;
  stepId: string;
  action: string;
  status: ScaffolderTaskStatus;
  startedAt: ISODateString | null;
  finishedAt: ISODateString | null;
  output: unknown;
  error: string | null;
}

export interface ScaffolderTaskLogRow {
  id: ID;
  stepId: string | null;
  level: "info" | "warn" | "error";
  body: string;
  createdAt: ISODateString;
}

export interface ScaffolderTask {
  id: ID;
  planId: ID;
  status: ScaffolderTaskStatus;
  startedAt: ISODateString;
  finishedAt: ISODateString | null;
  error: string | null;
  triggeredByUserId: ID;
  actorKind: ScaffolderActorKind;
  output: unknown;
  steps: ScaffolderTaskStepRow[];
  logs: ScaffolderTaskLogRow[];
}

export interface ScaffolderBinding {
  id: ID;
  templateId: string;
  templateVersion: string;
  templateHash: string;
  paramsHash: string;
  params: Record<string, unknown>;
  targetKind: "repo" | "feature-dir" | "catalog";
  targetRef: string;
  target: ScaffolderTarget;
  branchName: string | null;
  prUrl: string | null;
  ownerTeamId: ID | null;
  catalogEntityId: ID | null;
  active: boolean;
  appliedByUserId: ID;
  appliedAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ScaffolderDriftReport {
  id: ID;
  bindingId: ID;
  fromVersion: string;
  toVersion: string;
  diffSummary: unknown;
  status: ScaffolderDriftStatus;
  prUrl: string | null;
  detectedAt: ISODateString;
  resolvedAt: ISODateString | null;
}

// Members see only their own bindings; admins see everything.
export interface ScaffolderDriftSummaryDto {
  openCount: number;
  byBinding: Array<{
    bindingId: ID;
    targetRef: string;
    templateId: string;
    drifts: Array<{
      id: ID;
      fromVersion: string;
      toVersion: string;
      detectedAt: ISODateString;
      actions: string[];
    }>;
  }>;
}
