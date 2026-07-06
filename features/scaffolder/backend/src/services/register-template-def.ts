// Registration entry point for agent tools, mirrors the admin route but returns errors as data.
import { Prisma } from "@internal/db";
import { z } from "zod";
import { getActionRegistry, invalidateTemplateCache } from "./registry";
import { createTemplateDef, TemplateDefValidationError, YamlTemplateError } from "./template-defs";

export type RegisterTemplateDefResult =
  | { ok: true; id: string; identifier: string }
  | { ok: false; error: string };

export async function registerTemplateDefFromSource(input: {
  source: string;
  userId: string;
}): Promise<RegisterTemplateDefResult> {
  try {
    const row = await createTemplateDef({
      source: input.source,
      userId: input.userId,
      actions: getActionRegistry(),
    });
    invalidateTemplateCache();
    return { ok: true, id: row.id, identifier: row.identifier };
  } catch (err) {
    if (err instanceof TemplateDefValidationError || err instanceof YamlTemplateError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(", ");
      return { ok: false, error: `Invalid template: ${detail}` };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "A template with this metadata.name is already registered" };
    }
    throw err;
  }
}
