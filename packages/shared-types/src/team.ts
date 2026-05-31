// Shared DTOs for teams, memberships, and team/maintainer request negotiation.
import type { ID, ISODateString, NamedEntity } from "./common";

export interface Team extends NamedEntity {
  slug: string;
}

export type TeamMemberRole = "lead" | "member";

export interface TeamMembership {
  teamId: ID;
  userId: ID;
  role: TeamMemberRole;
  joinedAt: ISODateString;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}

export interface TeamSummary {
  id: ID;
  slug: string;
  name: string;
  description?: string | null;
  accountLogin: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  memberCount: number;
  leads: { userId: ID; displayName: string; avatarUrl?: string | null }[];
}

export interface TeamDetail extends TeamSummary {
  members: TeamMembership[];
}

export type TeamRequestStatus =
  | "pending"
  | "awaiting_user_confirmation"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

// Snapshot of the original submission, kept to render what changed during negotiation.
export interface TeamRequestOriginal {
  slug: string;
  name: string;
  description: string | null;
  mirrorToGithub: boolean;
  githubIntegrationId: ID | null;
}

export interface TeamRequestDto {
  id: ID;
  slug: string;
  name: string;
  description?: string | null;
  status: TeamRequestStatus;
  mirrorToGithub: boolean;
  githubIntegrationId: ID | null;
  githubOrgLogin: string | null;
  // Number of submit/propose/counter-propose edits so far (cap = 3).
  roundCount: number;
  lastEditedByUserId: ID | null;
  // "round_limit" when auto-cancelled by the negotiation cap, null otherwise.
  autoCancelReason: string | null;
  original: TeamRequestOriginal;
  rejectionReason?: string | null;
  createdTeamId?: ID | null;
  createdTeamSlug?: string | null;
  proposedMaintainers: Array<{ userId: ID; displayName: string; avatarUrl?: string | null }>;
  proposedMembers: Array<{ userId: ID; displayName: string; avatarUrl?: string | null }>;
  // Present only on the approval response when a GitHub mirror partially failed.
  partialFailures?: Array<{ userId: ID; displayName: string; reason: string }>;
  expiresAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  reviewedAt?: ISODateString | null;
  requestedBy: { userId: ID; displayName: string; avatarUrl?: string | null };
  reviewedBy?: { userId: ID; displayName: string; avatarUrl?: string | null } | null;
}

export type MaintainerRequestStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface MaintainerRequestDto {
  id: ID;
  teamId: ID;
  teamSlug: string;
  teamName: string;
  status: MaintainerRequestStatus;
  reason: string | null;
  rejectionReason: string | null;
  expiresAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  reviewedAt: ISODateString | null;
  requestedBy: { userId: ID; displayName: string; avatarUrl?: string | null };
  reviewedBy: { userId: ID; displayName: string; avatarUrl?: string | null } | null;
}

export type TeamPolicyKind = "name_pattern";

export interface TeamPolicyViolation {
  policyKind: TeamPolicyKind;
  field: "slug" | "name";
  message: string;
}

export interface TeamPolicyDto {
  kind: TeamPolicyKind;
  enabled: boolean;
  config: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  description: string | null;
  label: string;
}
