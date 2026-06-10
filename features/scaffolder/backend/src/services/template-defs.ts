// Port-style declarative template definitions: zod schema, compiler and jqQuery form resolution.
import { z } from "zod";
import { prisma } from "@internal/db";
import {
  defineTemplate,
  evalJq,
  type ActionRegistry,
  type Audience,
  type Capability,
  type CompiledTemplate,
  type Step,
  type TemplateOperation,
} from "@internal/scaffolder-core";
import { EVERYONE_SUBJECT_ID } from "./acl";

const KNOWN_CAPABILITIES: readonly string[] = [
  "fs:write",
  "db:write",
  "db:write:catalog",
  "repo:read",
  "network:external",
  "repo:public",
  "repo:private",
];

function isCapability(s: string): s is Capability {
  return KNOWN_CAPABILITIES.includes(s) || s.startsWith("secrets:read:");
}

const capabilitySchema = z.string().refine(isCapability, { message: "Unknown capability" });

const jqQueryNode = z.object({ jqQuery: z.string().min(1) }).strict();

const stepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "step id must be alphanumeric")
    .optional(),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

const userInputsSchema = z
  .object({
    properties: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    required: z.array(z.string()).default([]),
    order: z.array(z.string()).optional(),
  })
  .default({ properties: {}, required: [] });

export const templateDefSchema = z.object({
  identifier: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "identifier must be kebab-case starting with a letter"),
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, "expected semver"),
  operation: z.enum(["CREATE", "DAY-2", "DELETE"]).default("CREATE"),
  audience: z
    .array(z.enum(["human", "agent"]))
    .min(1)
    .default(["human"]),
  requiredRole: z.enum(["member", "admin"]).default("member"),
  requiredApproval: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  userInputs: userInputsSchema,
  steps: z.array(stepSchema).min(1),
  capabilities: z.array(capabilitySchema).default([]),
});

export type TemplateDef = z.infer<typeof templateDefSchema>;

const OPERATION_MAP: Record<TemplateDef["operation"], TemplateOperation> = {
  CREATE: "create",
  "DAY-2": "day2",
  DELETE: "delete",
};

// Mirrors required-vs-optional only, real validation is the resolved JSON Schema in the wizard.
function buildPermissiveParams(def: TemplateDef): z.ZodType<Record<string, unknown>> {
  const required = new Set(def.userInputs.required);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(def.userInputs.properties)) {
    shape[key] = required.has(key)
      ? z.unknown().refine((v) => v !== undefined, { message: `${key} is required` })
      : z.unknown().optional();
  }
  return z.object(shape).passthrough();
}

export function compileTemplateDef(def: TemplateDef): CompiledTemplate<Record<string, unknown>> {
  const steps: Step[] = def.steps.map((step, index) => ({
    id: step.id ?? `${step.action.replace(/[^a-zA-Z0-9]+/g, "_")}_${index}`,
    action: step.action,
    input: step.input,
  }));

  return defineTemplate({
    metadata: {
      id: def.identifier,
      version: def.version,
      name: def.title,
      description: def.description,
      tags: def.tags,
      ...(def.icon ? { icon: def.icon } : {}),
      audience: def.audience as Audience[],
      requiredRole: def.requiredRole,
      operation: OPERATION_MAP[def.operation],
      requiredApproval: def.requiredApproval,
    },
    parameters: buildPermissiveParams(def),
    capabilities: def.capabilities as Capability[],
    definitionSource: def,
    plan: () => steps,
  });
}

export interface FormContext {
  form: Record<string, unknown>;
  user: Record<string, unknown> | null;
  entity: Record<string, unknown> | null;
}

export interface ResolvedFormSchema {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
}

async function resolveMaybeJq(
  value: unknown,
  jqInput: unknown,
): Promise<{ dynamic: boolean; value: unknown }> {
  const parsed = jqQueryNode.safeParse(value);
  if (!parsed.success) return { dynamic: false, value };
  try {
    return { dynamic: true, value: await evalJq(jqInput, parsed.data.jqQuery) };
  } catch {
    return { dynamic: true, value: undefined };
  }
}

// Port-style dynamic form resolution: enum/default/visible/required/disabled accept {jqQuery}
// evaluated against {form, user, entity}.
export async function buildFormSchema(
  def: TemplateDef,
  ctx: FormContext,
): Promise<ResolvedFormSchema> {
  const jqInput = { form: ctx.form, user: ctx.user, entity: ctx.entity };
  const properties: Record<string, unknown> = {};
  const required = new Set(def.userInputs.required);
  const uiSchema: Record<string, unknown> = {};

  for (const [name, rawProp] of Object.entries(def.userInputs.properties)) {
    const prop: Record<string, unknown> = { ...rawProp };

    const rawVisible = prop.visible;
    const visible = await resolveMaybeJq(rawVisible, jqInput);
    delete prop.visible;
    if (visible.dynamic ? visible.value === false : rawVisible === false) {
      required.delete(name);
      continue;
    }

    const enumResolved = await resolveMaybeJq(prop.enum, jqInput);
    if (enumResolved.dynamic) {
      if (Array.isArray(enumResolved.value) && enumResolved.value.length > 0) {
        prop.enum = enumResolved.value;
      } else {
        delete prop.enum;
      }
    }

    const defaultResolved = await resolveMaybeJq(prop.default, jqInput);
    if (defaultResolved.dynamic) {
      if (defaultResolved.value === undefined || defaultResolved.value === null) {
        delete prop.default;
      } else {
        prop.default = defaultResolved.value;
      }
    }

    const requiredResolved = await resolveMaybeJq(prop.required, jqInput);
    delete prop.required;
    if (requiredResolved.dynamic && requiredResolved.value === true) required.add(name);

    const disabledResolved = await resolveMaybeJq(prop.disabled, jqInput);
    delete prop.disabled;
    if (disabledResolved.value === true) {
      uiSchema[name] = { ...(uiSchema[name] as object), "ui:disabled": true };
    }

    properties[name] = prop;
  }

  if (def.userInputs.order) {
    const known = def.userInputs.order.filter((k) => k in properties);
    uiSchema["ui:order"] = [...known, "*"];
  }

  return {
    schema: {
      type: "object",
      properties,
      required: [...required].filter((k) => k in properties),
    },
    uiSchema,
  };
}

export class TemplateDefValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateDefValidationError";
  }
}

function assertActionsExist(def: TemplateDef, actions: ActionRegistry): void {
  for (const step of def.steps) {
    try {
      actions.require(step.action);
    } catch {
      throw new TemplateDefValidationError(`Unknown action: ${step.action}`);
    }
  }
}

// Shared by CRUD and the editor preview, parses the raw JSON and checks every step action exists.
export function validateTemplateDef(raw: unknown, actions: ActionRegistry): TemplateDef {
  const def = templateDefSchema.parse(raw);
  assertActionsExist(def, actions);
  return def;
}

async function ensureDefaultAcl(templateId: string): Promise<void> {
  const existing = await prisma.templateAcl.findFirst({ where: { templateId } });
  if (existing) return;
  await prisma.templateAcl.create({
    data: {
      templateId,
      subjectType: "everyone",
      subjectId: EVERYONE_SUBJECT_ID,
      canView: true,
      canExecute: true,
    },
  });
}

export async function listTemplateDefs() {
  return prisma.scaffoldTemplateDef.findMany({ orderBy: { identifier: "asc" } });
}

export async function createTemplateDef(input: {
  raw: unknown;
  userId: string;
  actions: ActionRegistry;
  reservedIds: string[];
}) {
  const def = validateTemplateDef(input.raw, input.actions);
  if (input.reservedIds.includes(def.identifier)) {
    throw new TemplateDefValidationError(
      `Identifier ${def.identifier} is reserved by a built-in template`,
    );
  }
  const row = await prisma.scaffoldTemplateDef.create({
    data: {
      identifier: def.identifier,
      definition: def as never,
      createdByUserId: input.userId,
    },
  });
  await ensureDefaultAcl(def.identifier);
  return row;
}

export async function updateTemplateDef(input: {
  id: string;
  raw: unknown;
  actions: ActionRegistry;
  enabled?: boolean;
}) {
  const existing = await prisma.scaffoldTemplateDef.findUnique({ where: { id: input.id } });
  if (!existing) return null;
  const def = validateTemplateDef(input.raw, input.actions);
  if (def.identifier !== existing.identifier) {
    // Bindings, plans and ACLs key on the identifier, renaming would orphan them.
    throw new TemplateDefValidationError("identifier cannot be changed");
  }
  return prisma.scaffoldTemplateDef.update({
    where: { id: input.id },
    data: {
      definition: def as never,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    },
  });
}

export async function deleteTemplateDef(id: string): Promise<boolean> {
  const deleted = await prisma.scaffoldTemplateDef.deleteMany({ where: { id } });
  return deleted.count > 0;
}
