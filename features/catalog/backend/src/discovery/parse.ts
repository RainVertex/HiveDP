// Parses and validates catalog-info.yaml in two flavors (flat preferred, plus Backstage Component); best-effort, never throws.
import { parse as parseYaml } from "yaml";
import type { CatalogEntityKind } from "@internal/db";
import type { RegisterCatalogEntityInput } from "../service";

export const VALID_KINDS: ReadonlyArray<CatalogEntityKind> = [
  "service",
  "api",
  "library",
  "website",
  "database",
  "infrastructure",
];

export type ParseResult =
  | { kind: "ok"; input: RegisterCatalogEntityInput; yamlSpec: unknown }
  | { kind: "error"; reason: string };

export function parseCatalogInfo(path: string, raw: string): ParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    return { kind: "error", reason: `${path}: ${(err as Error).message}` };
  }
  if (!doc || typeof doc !== "object") {
    return { kind: "error", reason: `${path}: not an object` };
  }
  const flat = normalizeFlat(doc as Record<string, unknown>);
  const backstage = normalizeBackstage(doc as Record<string, unknown>);
  const candidate = flat ?? backstage;
  if (!candidate) {
    return {
      kind: "error",
      reason: `${path}: missing kind/name (flat) or metadata.name+spec.type (backstage)`,
    };
  }
  if (!VALID_KINDS.includes(candidate.kind)) {
    return {
      kind: "error",
      reason: `${path}: kind "${candidate.kind}" is not one of ${VALID_KINDS.join(", ")}`,
    };
  }
  return { kind: "ok", input: candidate, yamlSpec: doc };
}

function readOwnerTeamIds(doc: Record<string, unknown>): string[] {
  if (Array.isArray(doc.ownerTeamIds)) {
    return doc.ownerTeamIds.filter((t): t is string => typeof t === "string");
  }
  if (typeof doc.ownerTeamId === "string") return [doc.ownerTeamId];
  return [];
}

function normalizeFlat(doc: Record<string, unknown>): RegisterCatalogEntityInput | null {
  if (typeof doc.kind !== "string" || typeof doc.name !== "string") return null;
  return {
    kind: doc.kind as CatalogEntityKind,
    name: doc.name,
    description: typeof doc.description === "string" ? doc.description : null,
    ownerTeamIds: readOwnerTeamIds(doc),
    repoUrl: typeof doc.repoUrl === "string" ? doc.repoUrl : null,
    tags: Array.isArray(doc.tags) ? doc.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

function normalizeBackstage(doc: Record<string, unknown>): RegisterCatalogEntityInput | null {
  if (doc.kind !== "Component") return null;
  const metadata = doc.metadata as Record<string, unknown> | undefined;
  const spec = doc.spec as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata.name !== "string") return null;
  if (!spec || typeof spec.type !== "string") return null;
  return {
    kind: spec.type as CatalogEntityKind,
    name: metadata.name,
    description: typeof metadata.description === "string" ? metadata.description : null,
    ownerTeamIds: typeof spec.owner === "string" ? [spec.owner] : [],
    repoUrl: null,
    tags: Array.isArray(metadata.tags)
      ? metadata.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
}

export const CATALOG_INFO_FILE_NAMES = ["catalog-info.yaml", "catalog-info.yml"] as const;
