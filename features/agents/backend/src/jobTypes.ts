// Shared shapes for agent background work: the logger/context the drain core and cron jobs run under,
// and the cron job definition the API scheduler consumes.

export interface AgentJobLogger {
  info(o: unknown, msg?: string): void;
  error?(o: unknown, msg?: string): void;
}

export interface AgentJobContext {
  log: AgentJobLogger;
  signal: AbortSignal;
}

export interface AgentJobDefinition {
  name: string;
  schedule: string;
  timeoutMs?: number;
  handler: (ctx: AgentJobContext) => Promise<void>;
}
