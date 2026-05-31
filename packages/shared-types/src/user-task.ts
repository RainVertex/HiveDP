// DTO for per-user onboarding/checklist tasks.
import type { ID, ISODateString } from "./common";

export type UserTaskStatus = "pending" | "completed" | "dismissed";

export interface UserTaskDto {
  id: ID;
  kind: string;
  status: UserTaskStatus;
  payload: Record<string, unknown> | null;
  createdAt: ISODateString;
  completedAt: ISODateString | null;
}
