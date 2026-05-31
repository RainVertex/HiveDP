// Derives a draft-7 JSON Schema from a Zod schema for RJSF/AJV8 consumption.
import { z, type ZodType } from "zod";

export function toJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  // draft-7 (not 2020-12) because AJV8's default meta-schema set cannot resolve the 2020-12 $schema URL.
  return z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
