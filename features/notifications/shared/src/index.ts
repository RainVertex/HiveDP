import type { ID, ISODateString } from "@internal/shared-types";

// Every notification kind the platform emits. Producers (notify) and consumers (bell, inbox) share
// this union so a renamed or dropped kind fails to compile on both sides instead of drifting.
export type NotificationKind =
  | "projects.task.assigned"
  | "projects.task.commentAdded"
  | "team.member.added"
  | "team.member.removed"
  | "grafana.alert"
  | "grafana.alert.resolved";

export interface NotificationDto {
  id: ID;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  readAt: ISODateString | null;
  createdAt: ISODateString;
}
