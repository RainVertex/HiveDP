// DTOs for webhook subscriptions and their delivery attempts.
import type { ID, ISODateString } from "./common";

export interface WebhookSubscriptionDto {
  id: ID;
  ownerUserId?: ID | null;
  ownerTeamId?: ID | null;
  url: string;
  // Only returned at create time.
  secret?: string;
  eventKinds: string[];
  active: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WebhookDeliveryDto {
  id: ID;
  subscriptionId: ID;
  eventKind: string;
  status: "pending" | "succeeded" | "failed" | "dead";
  attemptCount: number;
  nextAttemptAt: ISODateString | null;
  lastAttemptAt: ISODateString | null;
  lastError: string | null;
  createdAt: ISODateString;
}
