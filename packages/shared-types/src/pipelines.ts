// Wire shapes for CI/CD pipeline rows, mirroring pipelines.prisma with BigInt ids dropped and Dates as ISO strings.
import type { ISODateString } from "./common";

export type WorkflowRunStatus = "queued" | "in_progress" | "completed";

export type WorkflowRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | "startup_failure";

export interface WorkflowRunRow {
  id: string;
  workflowName: string;
  workflowPath: string;
  runNumber: number;
  event: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion | null;
  headBranch: string | null;
  headSha: string;
  actorLogin: string | null;
  htmlUrl: string;
  runStartedAt: ISODateString | null;
  runUpdatedAt: ISODateString | null;
}

export type DeploymentState =
  | "pending"
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "error"
  | "inactive";

export interface DeploymentRow {
  id: string;
  environment: string;
  ref: string;
  sha: string;
  state: DeploymentState;
  actorLogin: string | null;
  description: string | null;
  htmlUrl: string | null;
  logUrl: string | null;
  deployedAt: ISODateString | null;
}
