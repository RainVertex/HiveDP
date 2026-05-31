// DTO types for the DevDocs feature (doc sync state, pages, comments, stale reports, search).
import type { ID, ISODateString } from "./common";

export type DocFreshness = "fresh" | "aging" | "stale" | "unknown";

export type DocSyncStatus = "ok" | "partial" | "failed";

export type DocResolvedSourceKind =
  | "spec-url"
  | "spec-path"
  | "docs-dir"
  | "readme"
  | "external"
  | "none";

export interface DocResolvedSource {
  kind: DocResolvedSourceKind;
  url?: string;
  path?: string;
}

export interface DocSyncStateRow {
  entityId: ID;
  status: DocSyncStatus;
  lastSyncedAt: ISODateString | null;
  lastError: string | null;
  pageCount: number;
  resolvedSource: DocResolvedSource | null;
}

export interface DocPageSummary {
  id: ID;
  entityId: ID;
  slug: string;
  path: string;
  title: string;
  lastCommitAt: ISODateString | null;
  lastCommitBy: string | null;
  verifiedAt: ISODateString | null;
  freshness: DocFreshness;
}

export interface DocPageDetail extends DocPageSummary {
  body: string;
  frontmatter: Record<string, unknown> | null;
  sourceRef: string;
  lastCommitSha: string | null;
  verifiedBy: string | null;
  commentCount: number;
  openStaleReports: number;
}

export interface DocCommentRow {
  id: ID;
  pageId: ID;
  body: string;
  anchor: string | null;
  createdAt: ISODateString;
  author: {
    id: ID;
    displayName: string;
    githubLogin: string;
    avatarUrl?: string | null;
  } | null;
}

export interface DocStaleReportRow {
  id: ID;
  pageId: ID;
  reason: string | null;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
  reporterId: ID;
}

export interface DocSearchHit {
  pageId: ID;
  entityId: ID;
  entityName: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface DocsTabResponse {
  syncState: DocSyncStateRow;
  pages: DocPageSummary[];
}
