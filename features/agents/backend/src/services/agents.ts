import { ensureAgentBackingUser } from "@internal/db";
import { listAvailableTools, listToolGroups } from "@internal/llm-core";
import { PROTECTED_AGENT_IDS } from "../constants";
import type { CreateAgentInput, UpdateAgentInput } from "../dto";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { cancelAgentRun, runAgent, startAgentRun, type RunAgentInput } from "../executor";
import { toAgentDetail, toAgentListItem } from "../mappers";
import { agentRepository } from "../repositories/agents";
import { runRepository } from "../repositories/runs";
import { getCallerTeamIds } from "./callers";
import { validateModelForSkills } from "./models";
import { assertSkillsExist } from "./skills";

export interface CallerContext {
  id: string;
  isAdmin: boolean;
}

type ToolListContext = { userId: string; isAdmin: boolean; teamIds: string[] };

export async function listAgents() {
  const agents = await agentRepository.listWithLatestRunAndModel();
  return agents.map((agent) => toAgentListItem(agent));
}

export function listTools(ctx: ToolListContext) {
  return { items: listAvailableTools(ctx), groups: listToolGroups(ctx) };
}

export async function getAgentDetail(id: string, caller: CallerContext) {
  const agent = await agentRepository.findDetail(id, caller.isAdmin ? undefined : caller.id);
  if (!agent) throw new NotFoundError("Agent not found");
  const conversationIds = [
    ...new Set(
      agent.runs.map((r) => r.conversationId).filter((cid): cid is string => Boolean(cid)),
    ),
  ];
  const conversations = conversationIds.length
    ? await agentRepository.findConversationTitles(conversationIds)
    : [];
  return toAgentDetail(agent, conversations);
}

export async function createAgent(input: CreateAgentInput) {
  await validateModelForSkills(input.modelId, input.skillIds);
  await assertSkillsExist(input.skillIds);

  const created = await agentRepository.create({
    name: input.name,
    description: input.description,
    avatarUrl: input.avatarUrl ?? null,
    category: input.category ?? null,
    kind: input.kind,
    modelId: input.modelId,
    instructions: input.instructions,
    skillIds: input.skillIds,
    approvalMode: input.approvalMode,
    maxToolCalls: input.maxToolCalls,
    tokenBudget: input.tokenBudget ?? null,
    temperature: input.temperature ?? null,
    assignableToTasks: input.assignableToTasks,
  });
  const backingUserId = await ensureAgentBackingUser(created.id, {
    name: created.name,
    avatarUrl: created.avatarUrl,
  });
  return { ...created, userId: backingUserId };
}

export async function updateAgent(id: string, input: UpdateAgentInput) {
  const existing = await agentRepository.findBasic(id);
  if (!existing) throw new NotFoundError("Agent not found");

  const effectiveModelId = input.modelId ?? existing.modelId;
  const effectiveSkillIds =
    input.skillIds ??
    (Array.isArray(existing.skillIds) ? (existing.skillIds as unknown as string[]) : []);
  await validateModelForSkills(effectiveModelId, effectiveSkillIds);

  if (input.skillIds && input.skillIds.length > 0) await assertSkillsExist(input.skillIds);

  const updated = await agentRepository.update(id, {
    name: input.name,
    description: input.description,
    avatarUrl: input.avatarUrl,
    category: input.category,
    kind: input.kind,
    modelId: input.modelId,
    instructions: input.instructions,
    skillIds: input.skillIds,
    approvalMode: input.approvalMode,
    maxToolCalls: input.maxToolCalls,
    tokenBudget: input.tokenBudget,
    temperature: input.temperature,
    assignableToTasks: input.assignableToTasks,
  });
  // Keep the backing User's display identity in sync (and create it for agents predating the backing-user link).
  await ensureAgentBackingUser(updated.id, { name: updated.name, avatarUrl: updated.avatarUrl });
  return updated;
}

export async function deleteAgent(id: string) {
  if (PROTECTED_AGENT_IDS.has(id)) {
    throw new BadRequestError("This is a built-in agent and cannot be deleted.");
  }
  const existing = await agentRepository.findBasic(id);
  if (!existing) throw new NotFoundError("Agent not found");
  await agentRepository.delete(id);
  if (existing.userId) await agentRepository.deleteBackingUser(existing.userId);
}

// A non-admin may view their own runs plus the agent's autonomous and task runs (owned by its backing
// user or unowned), which carry no private chat content. Other humans' runs stay hidden.
function canViewRun(
  run: { userId: string | null; user: { userKind: string } | null },
  caller: CallerContext,
): boolean {
  if (caller.isAdmin || run.userId === caller.id) return true;
  return run.userId == null || run.user?.userKind === "agent";
}

export async function getRun(agentId: string, runId: string, caller: CallerContext) {
  const run = await runRepository.findById(runId);
  if (!run || run.agentId !== agentId) throw new NotFoundError("Run not found");
  if (!canViewRun(run, caller)) throw new NotFoundError("Run not found");
  return run;
}

export async function cancelRun(agentId: string, runId: string, caller: CallerContext) {
  const run = await runRepository.findById(runId);
  if (!run || run.agentId !== agentId) throw new NotFoundError("Run not found");
  if (!canViewRun(run, caller)) throw new NotFoundError("Run not found");
  if (run.status !== "running") throw new ConflictError("Run is not running");
  // Graceful abort if the run is live here, otherwise it is orphaned (a prior process died mid-run),
  // so mark it failed directly. Single-process deployment, so "no live handle" means "not running".
  const aborted = cancelAgentRun(run.id);
  if (!aborted) await runRepository.markCancelled(run.id);
  return { ok: true, aborted };
}

export async function testAgent(id: string, prompt: string, caller: CallerContext) {
  const teamIds = await getCallerTeamIds(caller.id);
  return runAgent(
    id,
    { prompt },
    {
      callerUserId: caller.id,
      callerIsAdmin: caller.isAdmin,
      callerTeamIds: teamIds,
      trigger: "test",
    },
  );
}

export async function runAgentManual(id: string, input: RunAgentInput, caller: CallerContext) {
  const agent = await agentRepository.findBasic(id);
  if (!agent) throw new NotFoundError("Agent not found");
  const teamIds = await getCallerTeamIds(caller.id);
  const kicked = await startAgentRun(id, input, {
    callerUserId: caller.id,
    callerIsAdmin: caller.isAdmin,
    callerTeamIds: teamIds,
    trigger: "manual",
  });
  return { runId: kicked.runId, agentId: id, status: "running" as const };
}
