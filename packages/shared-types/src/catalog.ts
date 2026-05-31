// Shared types for catalog entities, drift records, relations, and entity overviews.
import type { ID, ISODateString, NamedEntity } from "./common";
import type { Team } from "./team";
import type { DoraMetricsSnapshot, ServiceHealthSample } from "./observability";
import type { ScorecardSummary } from "./scorecard";

export type CatalogEntityKind =
  | "service"
  | "api"
  | "library"
  | "website"
  | "database"
  | "infrastructure";

export type Lifecycle = "experimental" | "production" | "deprecated";

export type CatalogEntitySource = "manual" | "scaffolder" | "discovery" | "agent" | "seed";

export interface CatalogEntity extends NamedEntity {
  kind: CatalogEntityKind;
  lifecycle: Lifecycle;
  repoUrl?: string | null;
  tags: string[];
  source: CatalogEntitySource;
  sourceRef: string | null;
  lastSeenAt: ISODateString;
  staleSince: ISODateString | null;
  autoApply: boolean;
  /** Parsed catalog-info.yaml. */
  yamlSpec?: unknown;
  /** GitHub App auto-import bookkeeping. */
  needsOnboarding: boolean;
  unowned: boolean;
  installationId: number | null;
  githubRepoId: number | null;
  /** Computed at list time: installationId no longer matches any live installation. */
  orphaned: boolean;
}

export interface CatalogEntityWithOwners extends CatalogEntity {
  ownerTeams: Team[];
}

export type CatalogDriftStatus = "open" | "ignored" | "applied" | "superseded";

export interface CatalogDriftRow {
  id: ID;
  entityId: ID;
  kind: string;
  diff: unknown;
  status: CatalogDriftStatus;
  proposedBy: string;
  agentRunId: string | null;
  detectedAt: ISODateString;
  resolvedAt: ISODateString | null;
  entity?: CatalogEntityWithOwners;
}

export type CatalogRelationType =
  | "dependsOn"
  | "dependencyOf"
  | "consumesApi"
  | "apiConsumedBy"
  | "providesApi"
  | "apiProvidedBy"
  | "partOf"
  | "hasPart"
  | "memberOf"
  | "hasMember"
  | "ownerOf"
  | "ownedBy";

export interface CatalogRelation {
  type: CatalogRelationType | string;
  /** Resolved target entity (null if YAML references something not in catalog yet). */
  target: Pick<CatalogEntity, "id" | "name" | "kind" | "lifecycle"> | null;
  /** Original raw reference from yamlSpec (e.g., "component:default/foo"). */
  rawRef: string;
}

export interface CatalogRelationsResponse {
  outgoing: CatalogRelation[];
  incoming: CatalogRelation[];
}

export interface CatalogEntityLink {
  url: string;
  title: string;
  icon?: string | null;
}

export interface CatalogEntityOverview {
  entity: CatalogEntityWithOwners;
  drifts: CatalogDriftRow[];
  /** Total open drifts for this entity. may exceed drifts.length (capped at 20). */
  openDriftCount: number;
  dora: DoraMetricsSnapshot[];
  health: ServiceHealthSample[];
  scorecards: ScorecardSummary[];
  links: CatalogEntityLink[];
}
