// User identity DTOs: current user, admin rows, and lightweight summaries.
import type { ID, ISODateString, Timestamped } from "./common";

export type UserRole = "admin" | "member";
export type UserStatus = "active" | "disabled";

export interface CurrentUser extends Timestamped {
  id: ID;
  githubLogin: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: ISODateString | null;
}

export interface AdminUserRow extends CurrentUser {
  githubId: string;
}

export interface UserSummary {
  id: ID;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}
