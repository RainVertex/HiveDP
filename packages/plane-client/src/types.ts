// Plane REST API response types. Names mirror Plane's serializers; field
// shape is intentionally permissive (most are nullable) because Plane does
// not version its schema and field availability shifts between releases.
// Keep these as the response shape only — UI-facing DTOs live in
// @internal/shared-types and are derived from these by the sync upserts.

export interface PlanePage<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  /** Some Plane endpoints return `results`, others return the array directly. */
  results?: T[];
}

export interface PlaneApiWorkspace {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  organization_size?: string | null;
  owner?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaneApiProject {
  id: string;
  name: string;
  identifier: string;
  description?: string | null;
  emoji?: string | null;
  archived_at?: string | null;
  workspace: string; // workspace UUID
  created_at: string;
  updated_at: string;
}

export interface PlaneApiState {
  id: string;
  name: string;
  color?: string | null;
  group: string; // backlog | unstarted | started | completed | cancelled
  default: boolean;
  sequence: number;
  project: string;
}

export interface PlaneApiLabel {
  id: string;
  name: string;
  color?: string | null;
  project: string;
}

export interface PlaneApiCycle {
  id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  project: string;
  created_at: string;
  updated_at: string;
}

export interface PlaneApiModule {
  id: string;
  name: string;
  status?: string | null;
  project: string;
  created_at: string;
  updated_at: string;
}

export interface PlaneApiWorkItem {
  id: string;
  name: string;
  description_html?: string | null;
  description_stripped?: string | null;
  // Different Plane releases expose markdown under different keys. The sync
  // layer prefers `description_markdown` then falls back to stripped.
  description_markdown?: string | null;
  sequence_id: number;
  state: string | null; // PlaneState UUID
  priority: string;
  assignees: string[]; // PlaneMember UUIDs
  labels: string[]; // PlaneLabel UUIDs
  parent?: string | null;
  cycle?: string | null;
  module?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  completed_at?: string | null;
  project: string;
  created_at: string;
  updated_at: string;
}

export interface PlaneApiComment {
  id: string;
  comment_html?: string | null;
  comment_stripped?: string | null;
  comment_markdown?: string | null;
  actor?: string | null;
  actor_detail?: { id: string } | null;
  issue: string;
  project: string;
  workspace: string;
  created_at: string;
  updated_at: string;
}

export interface PlaneApiMember {
  id?: string;
  member?: {
    id: string;
    email: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    avatar?: string | null;
  };
  // Newer responses flatten member fields onto the row directly.
  email?: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar?: string | null;
  role?: number;
  /** Workspace UUID — used as a fallback to derive the workspace identity when listProjects */
  workspace?: string;
}

export interface PlaneClientConfig {
  baseUrl: string;
  apiToken: string;
  /** "apiKey" sends X-API-Key, "bearer" sends Authorization: Bearer. Default: "apiKey". */
  authMode?: "apiKey" | "bearer";
  /** Optional fetch override — used by tests to inject a stub. */
  fetch?: typeof fetch;
  /** Cap per-page size when paginating (Plane defaults are reasonable). */
  pageSize?: number;
}
