// Resolves a wizard string param marked with `x-github-orgs` into a dropdown of the
// GitHub App org/user logins the platform is connected to. The marker is always stripped
// before the schema reaches RJSF/AJV; the enum is only added once the logins are known.
import type { GithubInstallationSummary } from "@internal/shared-types";

const MARKER = "x-github-orgs";

type SchemaObject = Record<string, unknown>;

function isObject(value: unknown): value is SchemaObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function schemaUsesGithubOrgs(schema: SchemaObject | null | undefined): boolean {
  if (!isObject(schema) || !isObject(schema.properties)) return false;
  return Object.values(schema.properties).some((p) => isObject(p) && p[MARKER] === true);
}

export function orgLoginsFromInstallations(items: GithubInstallationSummary[]): string[] {
  const seen = new Set<string>();
  const logins: string[] = [];
  for (const item of items) {
    if (item.accountLogin && !seen.has(item.accountLogin)) {
      seen.add(item.accountLogin);
      logins.push(item.accountLogin);
    }
  }
  return logins;
}

// Drops the marker so AJV never sees a custom keyword, and (when logins exist) turns the
// field into an enum. With no connected orgs the field stays a free-text input.
export function withGithubOrgEnum(
  schema: SchemaObject | null,
  logins: string[],
): SchemaObject | null {
  if (!isObject(schema) || !isObject(schema.properties)) return schema;
  let changed = false;
  const nextProps: SchemaObject = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (isObject(value) && value[MARKER] === true) {
      const rest = { ...value };
      delete rest[MARKER];
      nextProps[key] = logins.length > 0 ? { ...rest, enum: logins } : rest;
      changed = true;
    } else {
      nextProps[key] = value;
    }
  }
  return changed ? { ...schema, properties: nextProps } : schema;
}
