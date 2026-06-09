// Shared types for catalog entities, relations, and entity overviews.
import type { ISODateString, NamedEntity } from "./common";
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
  /** Restricted, like yamlSpec: present only when the viewer may see restricted fields. */
  autoApply?: boolean;
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
  dora: DoraMetricsSnapshot[];
  health: ServiceHealthSample[];
  scorecards: ScorecardSummary[];
  links: CatalogEntityLink[];
}
