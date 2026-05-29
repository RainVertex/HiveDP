export type WidgetId =
  | "search"
  | "starred"
  | "toolkit"
  | "recently-visited"
  | "top-visited"
  | "onboarding"
  | "chat-assistant"
  | "service-health"
  | "grafana-alerts"
  | "my-tasks";

export interface VisitRecord {
  path: string;
  count: number;
  lastVisit: number;
}

export const HOME_LAYOUT_STORAGE_KEY = "mep:home-layout";
export const VISITS_STORAGE_KEY = "mep:visits";
