import { getRegisteredTools, type RegisteredTool } from "@internal/llm-core";
import type { AgentToolDescriptor, SkillSummary } from "@feature/agents-shared";
import type { CreateSkillInput, UpdateSkillInput } from "../dto";
import { BadRequestError, NotFoundError } from "../errors";
import { skillRepository, type SkillRow } from "../repositories/skills";

function toolIdsOf(skill: SkillRow): string[] {
  return Array.isArray(skill.toolIds) ? (skill.toolIds as unknown as string[]) : [];
}

function toToolDescriptors(toolIds: string[]): AgentToolDescriptor[] {
  return getRegisteredTools(toolIds).map((t) => ({
    id: t.id,
    name: t.openaiDef.function.name,
    description: t.openaiDef.function.description ?? "",
  }));
}

function toSummary(skill: SkillRow): SkillSummary {
  const toolIds = toolIdsOf(skill);
  return {
    id: skill.id,
    label: skill.label,
    description: skill.description,
    guidance: skill.guidance,
    toolIds,
    builtin: skill.builtin,
    tools: toToolDescriptors(toolIds),
  };
}

export async function listSkills() {
  const skills = await skillRepository.list();
  return { items: skills.map(toSummary) };
}

export async function getSkill(id: string) {
  const skill = await skillRepository.findById(id);
  if (!skill) throw new NotFoundError("Skill not found");
  return toSummary(skill);
}

export async function createSkill(input: CreateSkillInput) {
  const skill = await skillRepository.create({
    label: input.label,
    description: input.description ?? null,
    guidance: input.guidance ?? null,
    toolIds: input.toolIds ?? [],
  });
  return toSummary(skill);
}

export async function updateSkill(id: string, input: UpdateSkillInput) {
  const existing = await skillRepository.findById(id);
  if (!existing) throw new NotFoundError("Skill not found");
  const skill = await skillRepository.update(id, {
    label: input.label,
    description: input.description,
    guidance: input.guidance,
    toolIds: input.toolIds,
  });
  return toSummary(skill);
}

export async function deleteSkill(id: string) {
  const existing = await skillRepository.findById(id);
  if (!existing) throw new NotFoundError("Skill not found");
  if (existing.builtin) throw new BadRequestError("Built-in skills cannot be deleted.");
  await skillRepository.delete(id);
}

// Resolve an agent's skill ids to the tools they currently grant plus any guidance to inject. Tools
// are resolved leniently, so a removed or renamed tool is dropped rather than failing the run.
export async function resolveAgentSkills(
  skillIds: string[],
): Promise<{ tools: RegisteredTool[]; guidance: string[] }> {
  if (skillIds.length === 0) return { tools: [], guidance: [] };
  const rows = await skillRepository.findByIds(skillIds);
  const byId = new Map(rows.map((s) => [s.id, s]));
  const toolIds: string[] = [];
  const guidance: string[] = [];
  for (const id of skillIds) {
    const skill = byId.get(id);
    if (!skill) continue;
    toolIds.push(...toolIdsOf(skill));
    if (skill.guidance) guidance.push(`${skill.label}: ${skill.guidance}`);
  }
  return { tools: getRegisteredTools(toolIds), guidance };
}

// Appends resolved skill guidance to an agent's system prompt so the model knows when to use each skill.
export function appendSkillGuidance(instructions: string, guidance: string[]): string {
  if (guidance.length === 0) return instructions;
  return `${instructions}\n\nSkill guidance:\n${guidance.map((g) => `- ${g}`).join("\n")}`;
}

export async function assertSkillsExist(skillIds: string[]) {
  if (skillIds.length === 0) return;
  const rows = await skillRepository.findByIds(skillIds);
  const known = new Set(rows.map((s) => s.id));
  const missing = skillIds.filter((id) => !known.has(id));
  if (missing.length > 0) throw new BadRequestError(`Unknown skill ids: ${missing.join(", ")}`);
}
