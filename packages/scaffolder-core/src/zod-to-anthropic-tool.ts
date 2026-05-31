// Converts a Zod schema into an Anthropic tool definition.
import type { ZodType } from "zod";
import { toJsonSchema } from "./zod-to-jsonschema";

// Kept minimal to avoid a hard dep on @anthropic-ai/sdk from this package.
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export function toAnthropicTool(input: {
  name: string;
  description: string;
  schema: ZodType<unknown>;
}): AnthropicToolDef {
  const json = toJsonSchema(input.schema) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: input.name,
    description: input.description,
    input_schema: {
      type: "object",
      properties: json.properties ?? {},
      required: json.required ?? [],
    },
  };
}
