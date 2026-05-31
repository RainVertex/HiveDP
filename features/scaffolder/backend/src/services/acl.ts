// Filters templates by the actor's TemplateAcl entries (view or execute).
import { prisma } from "@internal/db";
import type { CompiledTemplate, Actor } from "@internal/scaffolder-core";

export async function filterByTemplateAcl<T extends CompiledTemplate<unknown>>(
  templates: readonly T[],
  actor: Actor,
  isAdmin: boolean,
  checkExecute = false,
): Promise<T[]> {
  if (isAdmin) return [...templates];
  const templateIds = templates.map((t) => t.metadata.id);
  if (templateIds.length === 0) return [];
  const aclRows = await prisma.templateAcl.findMany({
    where: {
      templateId: { in: templateIds },
      ...(checkExecute ? { canExecute: true } : { canView: true }),
      OR: [
        { subjectType: "user", subjectId: actor.userId },
        { subjectType: "team", subjectId: { in: actor.teamIds } },
        { subjectType: "everyone" },
      ],
    },
    select: { templateId: true },
  });
  const allowed = new Set(aclRows.map((r) => r.templateId));
  return templates.filter((t) => allowed.has(t.metadata.id));
}
