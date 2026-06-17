// Resolves a wizard array param marked with `x-platform-teams` into a multi-select of the platform
// teams that belong to the currently selected GitHub org. The marker is stripped before the schema
// reaches RJSF/AJV; the options are recomputed whenever the org selection changes.
import type { TeamSummary } from "@internal/shared-types";

const MARKER = "x-platform-teams";

type SchemaObject = Record<string, unknown>;

function isObject(value: unknown): value is SchemaObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function schemaUsesPlatformTeams(schema: SchemaObject | null | undefined): boolean {
  if (!isObject(schema) || !isObject(schema.properties)) return false;
  return Object.values(schema.properties).some((p) => isObject(p) && p[MARKER] === true);
}

// Forces the marked array field to render as checkboxes. Without this RJSF falls back to a single
// select for an array of enums, which yields a string value and an AJV "must be array" error.
export function platformTeamsUiSchema(schema: SchemaObject | null | undefined): SchemaObject {
  if (!isObject(schema) || !isObject(schema.properties)) return {};
  const ui: SchemaObject = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (isObject(value) && value[MARKER] === true) {
      ui[key] = { "ui:widget": "checkboxes" };
    }
  }
  return ui;
}

// Drops the marker so AJV never sees a custom keyword, and injects a oneOf of { const: id, title: name }
// into the array item schema for teams in the selected org. With no org or no matching teams the option
// list is empty and the field renders no choices.
export function withPlatformTeamsOneOf(
  schema: SchemaObject | null,
  teams: TeamSummary[],
  selectedOrg: string | null,
): SchemaObject | null {
  if (!isObject(schema) || !isObject(schema.properties)) return schema;
  let changed = false;
  const nextProps: SchemaObject = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (isObject(value) && value[MARKER] === true) {
      const rest = { ...value };
      delete rest[MARKER];
      const options = selectedOrg
        ? teams
            .filter((team) => team.accountLogin === selectedOrg)
            .map((team) => ({ const: team.id, title: team.name }))
        : [];
      const items: SchemaObject = isObject(rest.items) ? { ...rest.items } : { type: "string" };
      items.oneOf = options;
      nextProps[key] = { ...rest, items };
      changed = true;
    } else {
      nextProps[key] = value;
    }
  }
  return changed ? { ...schema, properties: nextProps } : schema;
}
