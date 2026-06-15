import { promises as fs } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  defineTemplate,
  type Audience,
  type CompiledTemplate,
  type Step,
} from "@internal/scaffolder-core";

// Compiles Backstage-style template.yaml documents into CompiledTemplates for the shared registry/executor.

export const TEMPLATE_API_VERSION = "scaffolder.platform/v1";

const VERSION_ANNOTATION = "scaffolder.platform/version";
const AUDIENCE_ANNOTATION = "scaffolder.platform/audience";
const REQUIRED_ROLE_ANNOTATION = "scaffolder.platform/requiredRole";

const stepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "step id must be alphanumeric")
    .optional(),
  name: z.string().optional(),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
});

const parameterPageSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const yamlTemplateSchema = z.object({
  apiVersion: z.union([
    z.literal(TEMPLATE_API_VERSION),
    z.literal("scaffolder.backstage.io/v1beta3"),
  ]),
  kind: z.literal("Template"),
  metadata: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case starting with a letter"),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    owner: z.string().optional(),
    type: z.string().optional(),
    parameters: z.union([parameterPageSchema, z.array(parameterPageSchema)]).optional(),
    steps: z.array(stepSchema).min(1),
    output: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type YamlTemplate = z.infer<typeof yamlTemplateSchema>;

function parameterPages(template: YamlTemplate): Array<z.infer<typeof parameterPageSchema>> {
  const { parameters } = template.spec;
  if (!parameters) return [];
  return Array.isArray(parameters) ? parameters : [parameters];
}

// Mirrors only required-vs-optional, real validation is the wizard's JSON Schema.
function buildPermissiveParams(template: YamlTemplate): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const page of parameterPages(template)) {
    const required = new Set(page.required ?? []);
    for (const key of Object.keys(page.properties ?? {})) {
      shape[key] = required.has(key)
        ? z.unknown().refine((v) => v !== undefined, { message: `${key} is required` })
        : z.unknown().optional();
    }
  }
  return z.object(shape).passthrough();
}

// Merges parameter pages into a single JSON Schema for the wizard.
export function wizardSchemaFromYaml(template: YamlTemplate): {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const page of parameterPages(template)) {
    for (const [key, prop] of Object.entries(page.properties ?? {})) {
      properties[key] = prop;
    }
    for (const key of page.required ?? []) {
      if (!required.includes(key)) required.push(key);
    }
  }
  return {
    schema: { type: "object", properties, required: required.filter((k) => k in properties) },
    uiSchema: {},
  };
}

function annotation(template: YamlTemplate, key: string): string | undefined {
  return template.metadata.annotations?.[key];
}

function audienceFor(template: YamlTemplate): Audience[] {
  const raw = annotation(template, AUDIENCE_ANNOTATION);
  if (!raw) return ["human"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Audience => s === "human" || s === "agent");
  return parsed.length > 0 ? parsed : ["human"];
}

export class YamlTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlTemplateError";
  }
}

export function parseYamlTemplate(source: string): YamlTemplate {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new YamlTemplateError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return yamlTemplateSchema.parse(raw);
}

export function compileYamlTemplate(
  template: YamlTemplate,
): CompiledTemplate<Record<string, unknown>> {
  const steps: Step[] = template.spec.steps.map((step, index) => ({
    id: step.id ?? `${step.action.replace(/[^a-zA-Z0-9]+/g, "_")}_${index}`,
    action: step.action,
    input: step.input ?? {},
  }));

  return defineTemplate({
    metadata: {
      id: template.metadata.name,
      version: annotation(template, VERSION_ANNOTATION) ?? "1.0.0",
      name: template.metadata.title ?? template.metadata.name,
      description: template.metadata.description ?? "",
      tags: template.metadata.tags ?? [],
      audience: audienceFor(template),
      requiredRole: annotation(template, REQUIRED_ROLE_ANNOTATION) === "admin" ? "admin" : "member",
    },
    parameters: buildPermissiveParams(template),
    capabilities: [],
    definitionSource: template,
    plan: () => steps,
  });
}

export function loadTemplateFromYamlString(
  source: string,
): CompiledTemplate<Record<string, unknown>> {
  return compileYamlTemplate(parseYamlTemplate(source));
}

export async function loadTemplateFromYamlFile(
  path: string,
): Promise<CompiledTemplate<Record<string, unknown>>> {
  return loadTemplateFromYamlString(await fs.readFile(path, "utf8"));
}
