import type { UserRole } from "@internal/db";

export interface AuditPayloads {
  "user.role.changed": { userId: string; before: UserRole; after: UserRole };
  "user.status.changed": { userId: string; before: string; after: string };
  "user.deleted": { userId: string; githubLogin: string; email: string; role: UserRole };
  "auth.signed_in": { userId: string; githubLogin: string };
  "auth.signed_out": { userId: string };
  "auth.org_denied": { githubLogin: string };
  "job.run.manual": { jobName: string; jobRunId: string };
  "job.toggled": { jobName: string; enabled: boolean };
  "integration.created": { integrationId: string; kind: string };
  "integration.updated": { integrationId: string; kind: string };
  "integration.deleted": { integrationId: string; kind: string };
  "integration.disconnected": {
    integrationId: string;
    kind: string;
    accountLogin: string;
    affectedUserCount: number;
    source: "admin_action" | "github_webhook";
  };
  "integration.resynced": { integrationId: string; kind: string; runId: string };
  "agent.suggestion.accepted": {
    suggestionId: string;
    agentId: string;
    targetKind: string;
    targetId: string;
  };
  "agent.suggestion.rejected": { suggestionId: string; agentId: string };
  "catalog.entity.updated": { entityId: string; fields: string[] };
  "catalog.pipelines.refresh": {
    entityId: string;
    runsUpserted: number;
    deploymentsUpserted: number;
    error: string | null;
  };
  "team.created": { teamId: string; slug: string };
  "team.updated": {
    teamId: string;
    before: { slug: string; name: string; description: string | null };
    after: { slug: string; name: string; description: string | null };
  };
  "team.soft_deleted": { teamId: string; slug: string };
  "team.restored": { teamId: string; slug: string };
  "team.hard_deleted": { teamId: string; slug: string };
  "team.ownership.transferred": {
    fromTeamId: string;
    toTeamId: string;
    entityCount: number;
  };
  "team.member.added": { teamId: string; userId: string; role: "lead" | "member" };
  "team.member.role_changed": {
    teamId: string;
    userId: string;
    before: "lead" | "member";
    after: "lead" | "member";
  };
  "team.member.removed": {
    teamId: string;
    userId: string;
    previousRole: "lead" | "member";
    selfInitiated: boolean;
  };
  "webhook.subscription.created": {
    subscriptionId: string;
    ownerUserId?: string;
    ownerTeamId?: string;
    eventKinds: string[];
  };
  "webhook.subscription.deleted": { subscriptionId: string };
  "webhook.delivery.failed": {
    subscriptionId: string;
    deliveryId: string;
    eventKind: string;
    attemptCount: number;
  };
  "scaffolder.plan.created": {
    planId: string;
    templateId: string;
    templateVersion: string;
    mode: string;
    target: string;
    actorKind: string;
  };
  "scaffolder.task.applied": {
    taskId: string;
    planId: string;
    templateId: string;
    status: string;
    rolledBack: boolean;
    durationMs: number;
  };
  "scaffolder.task.failed": {
    taskId: string;
    planId: string;
    templateId: string;
    error: string;
  };
  "scaffolder.mcp_token.minted": {
    tokenId: string;
    forUserId: string;
    scopes: string[];
    expiresAt: string;
  };
  "scaffolder.mcp_token.revoked": { tokenId: string };
  "scaffolder.binding.replanned": {
    bindingId: string;
    templateId: string;
    fromVersion: string;
    toVersion: string;
    planId: string;
  };
  "scaffolder.drift.resolved": {
    driftId: string;
    bindingId: string;
    status: "ignored" | "applied" | "superseded";
  };
  "page.created": {
    pageId: string;
    section: string;
    parentId: string | null;
    isFolder: boolean;
  };
  "page.updated": { pageId: string; fields: string[] };
  "page.moved": {
    pageId: string;
    fromParentId: string | null;
    toParentId: string | null;
  };
  "page.deleted": { pageId: string; section: string };
  "page.layout.updated": { pageId: string; widgetCount: number };
  "user.task.completed": { taskId: string; kind: string; auto: boolean };
  "user.task.dismissed": { taskId: string; kind: string };
  "department.created": { departmentId: string };
  "department.deleted": { departmentId: string };
  "department.member.added": { departmentId: string; userId: string };
  "department.member.removed": { departmentId: string; userId: string };
  "template_access_request.submitted": {
    requestId: string;
    templateId: string;
    requestedByUserId: string;
    permission: "view" | "execute";
  };
  "template_access_request.approved": {
    requestId: string;
    templateId: string;
    reviewedByUserId: string;
    aclId: string;
  };
  "template_access_request.rejected": {
    requestId: string;
    reviewedByUserId: string;
    reason: string;
  };
  "template_access_request.cancelled": { requestId: string; requestedByUserId: string };
  "template_acl.created": {
    templateId: string;
    aclId: string;
    subjectType: "user" | "team" | "everyone";
    subjectId: string;
    canView: boolean;
    canExecute: boolean;
  };
  "template_acl.updated": {
    templateId: string;
    aclId: string;
    subjectType: string;
    subjectId: string;
    canView: boolean;
    canExecute: boolean;
  };
  "template_acl.deleted": {
    templateId: string;
    aclId: string;
    subjectType: string;
    subjectId: string;
  };
}

export type AuditKind = keyof AuditPayloads;

export interface AuditTarget {
  kind: string;
  id: string;
}
