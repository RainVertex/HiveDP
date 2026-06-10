// Seeds a default-allow "everyone" TemplateAcl row for templates that have none.
import { prisma } from "@internal/db";
import { getTemplates } from "./registry";
import { EVERYONE_SUBJECT_ID } from "./acl";

export { EVERYONE_SUBJECT_ID } from "./acl";

export async function seedTemplateAcls(): Promise<{ created: number; skipped: number }> {
  const templates = (await getTemplates()).list();
  if (templates.length === 0) return { created: 0, skipped: 0 };

  const templateIds = templates.map((t) => t.metadata.id);
  const existing = await prisma.templateAcl.findMany({
    where: { templateId: { in: templateIds } },
    select: { templateId: true },
  });
  const hasAcl = new Set(existing.map((r) => r.templateId));

  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    if (hasAcl.has(t.metadata.id)) {
      skipped++;
      continue;
    }
    await prisma.templateAcl.create({
      data: {
        templateId: t.metadata.id,
        subjectType: "everyone",
        subjectId: EVERYONE_SUBJECT_ID,
        canView: true,
        canExecute: true,
      },
    });
    created++;
  }
  return { created, skipped };
}
