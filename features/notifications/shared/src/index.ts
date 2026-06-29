import type { ID, ISODateString } from "@internal/shared-types";

// Where a notification of a given kind links to when clicked. null renders as a non-navigating item.
export type NotificationHref = "task" | "project" | "team" | null;

// Coarse grouping a user can mute as a whole. The preference center toggles one row per category.
export type NotificationCategory =
  | "tasks"
  | "mentions"
  | "projectAccess"
  | "team"
  | "ops"
  | "alerts";

interface NotificationCatalogEntry {
  kind: string;
  category: NotificationCategory;
  href: NotificationHref;
}

// The single source of truth for every kind the platform emits. The kind union, the mute lookup,
// the frontend link target, the webhook subscription list, and the preference center all derive from
// this array, so a new kind is added in exactly one place.
export const NOTIFICATION_CATALOG = [
  { kind: "projects.task.assigned", category: "tasks", href: "task" },
  { kind: "projects.task.updated", category: "tasks", href: "task" },
  { kind: "projects.task.unassigned", category: "tasks", href: "task" },
  { kind: "projects.task.commentAdded", category: "tasks", href: "task" },
  { kind: "projects.task.dueSoon", category: "tasks", href: "task" },
  { kind: "projects.task.mentioned", category: "mentions", href: "task" },
  { kind: "projects.coding.completed", category: "tasks", href: "project" },
  { kind: "projects.member.added", category: "projectAccess", href: "project" },
  { kind: "projects.member.removed", category: "projectAccess", href: "project" },
  { kind: "projects.member.permissionChanged", category: "projectAccess", href: "project" },
  { kind: "team.member.added", category: "team", href: "team" },
  { kind: "team.member.removed", category: "team", href: "team" },
  { kind: "team.member.roleChanged", category: "team", href: "team" },
  { kind: "team.updated", category: "team", href: "team" },
  { kind: "team.deleted", category: "team", href: null },
  { kind: "team.ownershipTransferred", category: "team", href: "team" },
  { kind: "scaffolder.run.succeeded", category: "ops", href: null },
  { kind: "scaffolder.run.failed", category: "ops", href: null },
  { kind: "catalog.entity.ownershipChanged", category: "ops", href: null },
  { kind: "grafana.alert", category: "alerts", href: null },
  { kind: "grafana.alert.resolved", category: "alerts", href: null },
] as const satisfies readonly NotificationCatalogEntry[];

export type NotificationKind = (typeof NOTIFICATION_CATALOG)[number]["kind"];

export const NOTIFICATION_KINDS: NotificationKind[] = NOTIFICATION_CATALOG.map((e) => e.kind);

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  ...new Set(NOTIFICATION_CATALOG.map((e) => e.category)),
];

const KIND_TO_CATEGORY = Object.fromEntries(
  NOTIFICATION_CATALOG.map((e) => [e.kind, e.category]),
) as Record<NotificationKind, NotificationCategory>;

const KIND_TO_HREF = Object.fromEntries(
  NOTIFICATION_CATALOG.map((e) => [e.kind, e.href]),
) as Record<NotificationKind, NotificationHref>;

export function categoryForKind(kind: NotificationKind): NotificationCategory {
  return KIND_TO_CATEGORY[kind];
}

export function hrefKindFor(kind: NotificationKind): NotificationHref {
  return KIND_TO_HREF[kind];
}

export interface NotificationDto {
  id: ID;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  readAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface NotificationPreferenceDto {
  category: NotificationCategory;
  muted: boolean;
}
