import { Prisma, type AgentRun } from "@internal/db";
import { resolveProviderApiKey, type ResolvedModel } from "@internal/llm-core";
import { finalizeAgentRun } from "../runFinalize";
import type { RunAgentInput, RunAgentOptions, RunAgentResult } from "../runTypes";
import { resolveCodingRepoCoords, mintRepoGitToken } from "./repo";
import { buildAiderModelConfig } from "./aiderModel";
import { runCodingContainer } from "./containerPool";
import { openDraftPr } from "./pr";
import type { CodingJobSpec, CodingRunInput, CodingRunnerResult } from "./types";

type AgentWithModel = Prisma.AgentGetPayload<{
  include: { llmModel: { include: { provider: true } } };
}>;

export interface RunCodingAgentArgs {
  agent: AgentWithModel;
  input: RunAgentInput;
  opts: RunAgentOptions;
  run: AgentRun;
  runSignal: AbortSignal;
}

// Coding-runtime execution: resolve the provider key + repo, mint a short-lived git token, run Aider in
// the sandbox container, and open a draft PR for whatever it pushed. Returns the same RunAgentResult
// shape as the chat loop so the queue and AgentRun lifecycle are identical.
export async function runCodingAgent(args: RunCodingAgentArgs): Promise<RunAgentResult> {
  const { agent, input, opts, run, runSignal } = args;
  const model = agent.llmModel as ResolvedModel;

  const fail = (error: string, output: Record<string, unknown> = {}): Promise<RunAgentResult> =>
    finalizeAgentRun({
      runId: run.id,
      model,
      status: "failed",
      tokensInput: 0,
      tokensOutput: 0,
      output: output as Prisma.InputJsonValue,
      finalText: error,
      toolCalls: [],
      error,
      containsWrites: false,
    });

  // The coding runtime spawns Docker; the API process must never do that. Only the coding worker sets
  // CODING_RUNTIME_ENABLED, so a coding agent run that lands in the API process fails closed.
  if (process.env.CODING_RUNTIME_ENABLED !== "1") {
    return fail(
      "Coding runtime is not enabled in this process; coding agents run only in the coding worker.",
    );
  }

  const aider = buildAiderModelConfig(agent.llmModel.provider, agent.llmModel.modelName);
  if ("error" in aider) return fail(aider.error);

  const ci = input as Partial<CodingRunInput>;
  const instruction = typeof ci.instruction === "string" ? ci.instruction.trim() : "";
  if (!instruction) return fail("Coding run has no instruction.");
  if (!ci.repo) return fail("Coding run input is missing repo coordinates.");

  const coords = resolveCodingRepoCoords({
    repoUrl: ci.repo.repoUrl ?? null,
    installationId: ci.repo.installationId ?? null,
  });
  if ("error" in coords) return fail(coords.error);

  let apiKey: string | null;
  try {
    apiKey = await resolveProviderApiKey({
      providerId: agent.llmModel.provider.id,
      providerSlug: agent.llmModel.provider.slug,
      apiKeyEnvVar: agent.llmModel.provider.apiKeyEnvVar,
      isAdmin: opts.callerIsAdmin ?? false,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (aider.apiKeyEnvVar && !apiKey) {
    return fail(`The ${agent.llmModel.provider.displayName} provider has no API key configured.`);
  }

  let gitToken: string;
  try {
    gitToken = await mintRepoGitToken(coords.installationId);
  } catch (err) {
    return fail(
      `Could not mint a GitHub installation token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const branch = sanitizeBranch(ci.branch) ?? buildBranchName(agent, ci, run.id);
  const spec: CodingJobSpec = {
    repoUrl: coords.repoUrl,
    owner: coords.owner,
    repo: coords.repo,
    branch,
    message: buildMessage(agent.instructions, instruction),
    aiderModel: aider.aiderModel,
    apiKeyEnvVar: aider.apiKeyEnvVar,
    apiBase: aider.apiBase,
  };

  let result: CodingRunnerResult;
  try {
    result = await runCodingContainer({
      spec,
      apiKey: apiKey ?? "",
      gitToken,
      signal: runSignal,
    });
  } catch (err) {
    const aborted = runSignal.aborted;
    const message = aborted
      ? "Coding run cancelled."
      : err instanceof Error
        ? err.message
        : String(err);
    return finalizeAgentRun({
      runId: run.id,
      model,
      status: aborted ? "cancelled" : "failed",
      tokensInput: 0,
      tokensOutput: 0,
      output: { branch } as unknown as Prisma.InputJsonValue,
      finalText: message,
      toolCalls: [],
      error: message,
      containsWrites: false,
    });
  }

  const usage = result.usage;
  if (runSignal.aborted) {
    return finalizeAgentRun({
      runId: run.id,
      model,
      status: "cancelled",
      tokensInput: usage.input,
      tokensOutput: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: {
        branch: result.branch,
        hadChanges: result.hadChanges,
      } as unknown as Prisma.InputJsonValue,
      finalText: result.finalText,
      toolCalls: [],
      error: "Cancelled by user.",
      containsWrites: result.hadChanges,
    });
  }
  if (!result.ok) {
    const error = result.error ?? "Coding run failed.";
    return finalizeAgentRun({
      runId: run.id,
      model,
      status: "failed",
      tokensInput: usage.input,
      tokensOutput: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: { branch: result.branch } as unknown as Prisma.InputJsonValue,
      finalText: result.finalText ?? `Coding run failed: ${error}`,
      toolCalls: [],
      error,
      containsWrites: false,
    });
  }

  let prUrl: string | null = null;
  if (result.hadChanges) {
    try {
      const pr = await openDraftPr({
        installationId: coords.installationId,
        owner: coords.owner,
        repo: coords.repo,
        branch: result.branch,
        title: prTitle(ci, instruction),
        body: prBody(ci, result.finalText),
      });
      prUrl = pr.prUrl;
    } catch (err) {
      const message = `Pushed branch ${result.branch} but could not open a PR: ${err instanceof Error ? err.message : String(err)}`;
      return finalizeAgentRun({
        runId: run.id,
        model,
        status: "failed",
        tokensInput: usage.input,
        tokensOutput: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        output: { branch: result.branch, hadChanges: true } as unknown as Prisma.InputJsonValue,
        finalText: message,
        toolCalls: [],
        error: message,
        containsWrites: true,
      });
    }
  }

  return finalizeAgentRun({
    runId: run.id,
    model,
    status: "succeeded",
    tokensInput: usage.input,
    tokensOutput: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    output: {
      prUrl,
      branchName: result.branch,
      finalText: result.finalText,
      hadChanges: result.hadChanges,
    } as unknown as Prisma.InputJsonValue,
    finalText: summarize(prUrl, result),
    toolCalls: [],
    error: null,
    containsWrites: result.hadChanges,
  });
}

function sanitizeBranch(branch: string | undefined): string | null {
  if (!branch) return null;
  const clean = branch
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return clean.length > 0 ? clean : null;
}

function buildBranchName(
  agent: AgentWithModel,
  ci: Partial<CodingRunInput>,
  runId: string,
): string {
  const slug = (agent.name || "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const scope = ci.task?.id ? `task-${ci.task.id}` : "adhoc";
  return `agent/${slug || "agent"}/${scope}-${runId.slice(0, 8)}`;
}

function prTitle(ci: Partial<CodingRunInput>, instruction: string): string {
  if (ci.task?.title) return `${ci.task.title}`;
  const firstLine = instruction.split(/\r?\n/)[0].trim();
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine || "Automated change";
}

function prBody(ci: Partial<CodingRunInput>, finalText: string | null): string {
  const parts: string[] = [];
  if (ci.task?.id) parts.push(`Task: ${ci.task.title ?? ci.task.id}`);
  if (finalText) parts.push(finalText);
  parts.push("\nOpened by an automated coding agent.");
  return parts.join("\n\n");
}

// Aider takes a single --message. Prepend the agent's own instructions as guidance, then the task.
function buildMessage(instructions: string, task: string): string {
  const guidance = instructions.trim();
  return guidance ? `${guidance}\n\n---\n\nTask:\n${task}` : task;
}

function summarize(prUrl: string | null, result: CodingRunnerResult): string {
  if (prUrl) return `Opened a draft PR on branch ${result.branch}: ${prUrl}`;
  if (!result.hadChanges) return result.finalText ?? "No changes were needed.";
  return `Pushed branch ${result.branch}.`;
}
