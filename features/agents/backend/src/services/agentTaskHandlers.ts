import type { RunAgentInput, RunAgentOptions, RunAgentResult } from "../executor";

// Per-kind interpretation of an agent task. The queue runs the agent, a handler
// turns the run result into a task outcome and any side effects (post a comment,
// open a PR, etc.). Registered at boot by the feature that owns the kind.

export interface AgentTaskOutcome {
  status: "done" | "skipped" | "retry";
  lastError?: string | null;
  // Shallow-merged into the task payload on a terminal outcome.
  payloadPatch?: Record<string, unknown>;
}

// Runs before the agent. ready:false re-queues the task without spending an attempt (e.g. the
// provider is not configured yet), so transient unavailability does not burn the retry budget.
export interface AgentTaskPrecheck {
  ready: boolean;
  reason?: string;
  delayMs?: number;
}

export interface AgentTaskHandler {
  precheck?: (payload: Record<string, unknown>) => AgentTaskPrecheck | Promise<AgentTaskPrecheck>;
  buildRunInput: (payload: Record<string, unknown>) => RunAgentInput | Promise<RunAgentInput>;
  runOptions?: (
    payload: Record<string, unknown>,
  ) => Partial<RunAgentOptions> | Promise<Partial<RunAgentOptions>>;
  interpret?: (ctx: {
    payload: Record<string, unknown>;
    result: RunAgentResult;
  }) => AgentTaskOutcome | Promise<AgentTaskOutcome>;
}

const HANDLERS = new Map<string, AgentTaskHandler>();

export function registerAgentTaskHandler(kind: string, handler: AgentTaskHandler): void {
  HANDLERS.set(kind, handler);
}

export function getAgentTaskHandler(kind: string): AgentTaskHandler | undefined {
  return HANDLERS.get(kind);
}

// Maps a run result to an outcome when a handler supplies no interpret of its own.
export function defaultInterpret(result: RunAgentResult): AgentTaskOutcome {
  if (result.status === "succeeded") return { status: "done" };
  if (result.status === "cancelled") return { status: "skipped", lastError: result.error };
  return { status: "retry", lastError: result.error };
}
