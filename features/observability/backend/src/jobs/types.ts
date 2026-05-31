// Structural mirror of apps/api JobDefinition, redeclared because features cannot import apps/api (boundary rule).

export interface ObservabilityJobLogger {
  info(o: unknown, msg?: string): void;
  error?(o: unknown, msg?: string): void;
}

export interface ObservabilityJobContext {
  log: ObservabilityJobLogger;
  signal: AbortSignal;
}

export interface ObservabilityJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: ObservabilityJobContext) => Promise<void>;
}
