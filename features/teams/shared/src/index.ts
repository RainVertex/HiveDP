// Shared DTOs for teams and memberships.
import type { ID, ISODateString, NamedEntity } from "@internal/shared-types";

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
