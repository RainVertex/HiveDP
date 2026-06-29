import type { ChatRequest, ChatResult } from "@internal/llm-core";

// Shared shapes for an agent run. Kept out of executor.ts so the coding runtime can depend on them
// without importing the chat executor (which would form an import cycle).

export type RunAgentInput = Record<string, unknown>;

export interface RunAgentToolCall {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  isError: boolean;
}

// One LLM turn: the assistant's reasoning and text, plus the tools it invoked that turn.
export interface RunAgentStep {
  index: number;
  text: string | null;
  reasoning: string | null;
  toolCalls: RunAgentToolCall[];
  tokensInput: number;
  tokensOutput: number;
}

export interface RunAgentResult {
  agentRunId: string;
  status: "succeeded" | "failed" | "cancelled";
  toolCalls: RunAgentToolCall[];
  finalText: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number | null;
  error: string | null;
}

export interface RunAgentOptions {
  chat?: (req: ChatRequest) => Promise<ChatResult>;
  signal?: AbortSignal;
  callerUserId?: string | null;
  callerIsAdmin?: boolean;
  callerTeamIds?: string[];
  existingRunId?: string;
  // Hard wall-clock ceiling for this run; defaults per runtime from env when unset.
  timeoutMs?: number;
  // Provenance recorded on the AgentRun so a bot's history is queryable and contextual.
  trigger?: string;
  taskId?: string | null;
  conversationId?: string | null;
}
