export interface SeedTask {
  kind: string;
  payload: Record<string, unknown>;
}

export const SEED_TASKS: SeedTask[] = [
  { kind: "request-tool-access", payload: {} },
  { kind: "team-join", payload: {} },
];
