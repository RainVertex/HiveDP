// Shapes shared between the coding runtime (host side) and the sandbox runner. The whole job, including
// the provider key and git token, is written to the container's stdin as one CodingJobPayload. Secrets
// go through stdin (not argv, not env) so they never appear in `ps` or `docker inspect`, and so a warm
// container started before the task is known can receive them when the job is assigned. The result is
// the single JSON line the runner prints to stdout.

export interface CodingJobSpec {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  // The full prompt handed to Aider via --message (agent guidance plus the task).
  message: string;
  // Aider --model string in LiteLLM format (e.g. "gpt-5.5", "anthropic/claude-opus-4-7").
  aiderModel: string;
  // The env var Aider expects the provider key under (e.g. "OPENAI_API_KEY"); null for keyless (Ollama).
  apiKeyEnvVar: string | null;
  // Optional base URL for an OpenAI-compatible or Ollama endpoint.
  apiBase: string | null;
}

// The complete payload written to a (possibly pre-warmed) container's stdin: the non-secret spec plus
// the per-run secrets. Empty llmApiKey for keyless providers (Ollama).
export interface CodingJobPayload {
  spec: CodingJobSpec;
  llmApiKey: string;
  gitToken: string;
}

export interface CodingUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CodingRunnerResult {
  ok: boolean;
  hadChanges: boolean;
  branch: string;
  finalText: string | null;
  usage: CodingUsage;
  error: string | null;
}

// The input a coding agent receives from a task handler. The handler resolves repoUrl + installationId
// (both non-secret) via getProjectRepoRef and passes them here; runCodingAgent parses coordinates and
// mints the short-lived git token at run time so no token is ever persisted in AgentRun.input.
export interface CodingRunInput {
  instruction: string;
  repo: { repoUrl: string | null; installationId: number | null };
  branch?: string;
  task?: { id: string; title: string };
  project?: { id: string; title: string };
}
