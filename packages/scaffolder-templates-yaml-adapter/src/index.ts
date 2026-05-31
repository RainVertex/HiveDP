import { promises as fs } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  defineTemplate,
  type Audience,
  type Capability,
  type CompiledTemplate,
  type Step,
} from "@internal/scaffolder-core";

// Loads a Backstage-style template.yaml into a CompiledTemplate for the shared registry/executor.

const stringOrSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
});

const parameterPageSchema = z.object({
  title: z.string().optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const yamlTemplateSchema = z.object({
  apiVersion: z.string().min(1),
  kind: z.literal("Template"),
  metadata: z.object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    annotations: z.record(z.string(), stringOrSchema).optional(),
  }),
  spec: z.object({
    owner: z.string().optional(),
    type: z.string().optional(),
    parameters: z.union([parameterPageSchema, z.array(parameterPageSchema)]).optional(),
    steps: z.array(stepSchema).default([]),
    output: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type YamlTemplate = z.infer<typeof yamlTemplateSchema>;

export interface YamlAdapterOptions {
  templateIdOverride?: string;
  version?: string;
  audience?: Audience[];
  capabilities?: Capability[];
}

const VERSION_ANNOTATION = "scaffolder.platform/version";

function buildPermissiveSchema(
  parameters: YamlTemplate["spec"]["parameters"],
): z.ZodType<Record<string, unknown>> {
  // Mirror only required-vs-optional; precise type validation is deferred to the wizard's JSON Schema.
  const pages = parameters ? (Array.isArray(parameters) ? parameters : [parameters]) : [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const page of pages) {
    const required = new Set(page.required ?? []);
    for (const key of Object.keys(page.properties ?? {})) {
      shape[key] = required.has(key)
        ? z.unknown().refine((v) => v !== undefined, { message: `${key} is required` })
        : z.unknown().optional();
    }
  }
  return z.object(shape).passthrough();
}

export function loadTemplateFromYamlString(
  source: string,
  options: YamlAdapterOptions = {},
): CompiledTemplate<Record<string, unknown>> {
  const raw = parseYaml(source) as unknown;
  const parsed = yamlTemplateSchema.parse(raw);

  const id = options.templateIdOverride ?? parsed.metadata.name;
  const annotations = parsed.metadata.annotations ?? {};
  const annotated = annotations[VERSION_ANNOTATION];
  const version = options.version ?? (typeof annotated === "string" ? annotated : "1.0.0");

  const params = buildPermissiveSchema(parsed.spec.parameters);

  const steps: Step[] = parsed.spec.steps.map((step, index) => ({
    id: step.id ?? `${step.action}-${index}`,
    action: step.action,
    input: step.input ?? {},
  }));

  return defineTemplate({
    metadata: {
      id,
      version,
      name: parsed.metadata.title ?? parsed.metadata.name,
      description: parsed.metadata.description ?? "",
      tags: parsed.metadata.tags ?? [],
      audience: options.audience ?? ["human"],
      requiredRole: "member",
    },
    parameters: params,
    capabilities: options.capabilities ?? [],
    plan: () => steps,
  });
}

export async function loadTemplateFromYamlFile(
  path: string,
  options: YamlAdapterOptions = {},
): Promise<CompiledTemplate<Record<string, unknown>>> {
  const source = await fs.readFile(path, "utf8");
  return loadTemplateFromYamlString(source, options);
}
