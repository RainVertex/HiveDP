// The workspace module is a single pane of glass over Plane (see
// packages/db/prisma/schema.prisma — PlaneWorkspace, PlaneProject, etc.). DTOs
// expose what the UI needs, not the full mirror row — `raw` Json stays
// server-side. Field names track Plane's terminology (work-items, cycles,
// modules) so we don't introduce a translation layer.

import type { ID, ISODateString } from "./common";

/** Plane state group. */
export type PlaneStateGroup =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled"
  | string;

/** Plane priority enum. */
export type PlanePriority = "none" | "low" | "medium" | "high" | "urgent" | string;

export interface PlaneStateDto {
  id: ID;
  externalId: string;
  name: string;
  color: string | null;
  group: PlaneStateGroup;
  order: number;
  isDefault: boolean;
}

export interface PlaneLabelDto {
  id: ID;
  externalId: string;
  name: string;
  color: string | null;
}

export interface PlaneCycleDto {
  id: ID;
  externalId: string;
  name: string;
  startDate: ISODateString | null;
  endDate: ISODateString | null;
}

export interface PlaneModuleDto {
  id: ID;
  externalId: string;
  name: string;
  status: string | null;
}

export interface PlaneMemberDto {
  id: ID;
  externalId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlaneProjectDto {
  id: ID;
  integrationId: ID;
  workspaceId: ID;
  externalId: string;
  identifier: string;
  name: string;
  description: string | null;
  emoji: string | null;
  archivedAt: ISODateString | null;
  lastSyncedAt: ISODateString | null;
  /** Convenience counts (computed on read, not stored). */
  workItemCount?: number;
  openWorkItemCount?: number;
}

export interface PlaneWorkItemSummaryDto {
  id: ID;
  projectId: ID;
  externalId: string;
  sequenceId: number;
  name: string;
  state: PlaneStateDto | null;
  priority: PlanePriority;
  assigneeIds: string[];
  labelIds: string[];
  startDate: ISODateString | null;
  targetDate: ISODateString | null;
  completedAt: ISODateString | null;
  externalCreatedAt: ISODateString;
  externalUpdatedAt: ISODateString;
  /** Embedded for list rendering; null when project is not in the response. */
  project?: { id: ID; identifier: string; name: string } | null;
  /** Deep link to the work item in Plane's native UI; undefined when integration config is incomplete. */
  planeUrl?: string;
}

export interface PlaneWorkItemDetailDto extends PlaneWorkItemSummaryDto {
  description: string | null;
  parentId: ID | null;
  cycleId: ID | null;
  moduleId: ID | null;
  /** Hydrated for the detail view. */
  parent?: PlaneWorkItemSummaryDto | null;
  subItems: PlaneWorkItemSummaryDto[];
  comments: PlaneCommentDto[];
}

export interface PlaneCommentDto {
  id: ID;
  workItemId: ID;
  externalId: string;
  authorExternalId: string | null;
  /** Hydrated from PlaneMember by authorExternalId; null when the author left or is unknown. */
  author: { displayName: string; email: string; avatarUrl: string | null } | null;
  body: string;
  externalCreatedAt: ISODateString;
  externalUpdatedAt: ISODateString;
}

/** Aggregator response for the /workspace landing — one round-trip. */
export interface MyWorkDto {
  /** Work items where the current user is mapped to a Plane assignee. */
  myOpenWorkItems: PlaneWorkItemSummaryDto[];
  /** Projects from any integration the user has any work in (or starred). */
  recentProjects: PlaneProjectDto[];
  /** True when no Plane integration exists yet — UI shows the connect CTA. */
  needsIntegration: boolean;
  /** True when the user has no PlaneUserMapping for any active integration. */
  needsUserMapping: boolean;
}

export interface PlaneIntegrationStatusDto {
  integrationId: ID;
  name: string;
  enabled: boolean;
  workspaceSlug: string;
  workspaceName: string | null;
  lastFullSyncAt: ISODateString | null;
  lastWebhookAt: ISODateString | null;
  projectCount: number;
  memberCount: number;
  unmappedMemberCount: number;
  /** True once the admin has saved the secret Plane generated for the webhook. */
  hasWebhookSecret: boolean;
}

export interface PlaneUserMappingDto {
  id: ID;
  platformUserId: ID;
  planeMemberId: ID;
  member: PlaneMemberDto;
  user: { id: ID; displayName: string; email: string; avatarUrl: string | null };
  createdAt: ISODateString;
}
