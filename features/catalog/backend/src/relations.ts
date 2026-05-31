// Resolves Backstage-style catalog relations (outgoing and incoming) for an entity.

import { prisma } from "@internal/db";
import type { CatalogEntityKind } from "@internal/db";
import type {
  CatalogRelation,
  CatalogRelationType,
  CatalogRelationsResponse,
} from "@internal/shared-types";

const VALID_KINDS: ReadonlyArray<CatalogEntityKind> = [
  "service",
  "api",
  "library",
  "website",
  "database",
  "infrastructure",
];

/** Backstage ref: "[<kind>:][<namespace>/]<name>", namespace is ignored. */
function parseRef(raw: string): { kind: CatalogEntityKind | null; name: string } {
  const trimmed = raw.trim();
  let kindPart: string | null = null;
  let rest = trimmed;
  const colon = trimmed.indexOf(":");
  if (colon !== -1) {
    kindPart = trimmed.slice(0, colon).toLowerCase();
    rest = trimmed.slice(colon + 1);
  }
  const slash = rest.indexOf("/");
  const name = slash !== -1 ? rest.slice(slash + 1) : rest;
  let kind: CatalogEntityKind | null = null;
  if (kindPart) {
    const k = kindPart === "component" ? null : (kindPart as CatalogEntityKind);
    kind = k && VALID_KINDS.includes(k) ? k : null;
  }
  return { kind, name };
}

/** Outgoing relations declared in a yamlSpec blob. */
function readOutgoing(yamlSpec: unknown): Array<{ type: CatalogRelationType; rawRef: string }> {
  const yaml = yamlSpec as Record<string, unknown> | null | undefined;
  if (!yaml) return [];
  const out: Array<{ type: CatalogRelationType; rawRef: string }> = [];

  const spec = yaml.spec as Record<string, unknown> | undefined;
  if (spec) {
    pushRefs(out, "dependsOn", spec.dependsOn);
    pushRefs(out, "consumesApi", spec.consumesApis);
    pushRefs(out, "providesApi", spec.providesApis);
    pushRefs(out, "partOf", spec.partOf);
    if (typeof spec.system === "string") out.push({ type: "partOf", rawRef: spec.system });
    if (typeof spec.owner === "string") out.push({ type: "ownedBy", rawRef: spec.owner });
  }

  const metadata = yaml.metadata as Record<string, unknown> | undefined;
  const rels = metadata?.relations;
  if (Array.isArray(rels)) {
    for (const r of rels) {
      if (!r || typeof r !== "object") continue;
      const type = (r as Record<string, unknown>).type;
      const target = (r as Record<string, unknown>).target;
      if (typeof type === "string" && typeof target === "string") {
        out.push({ type: type as CatalogRelationType, rawRef: target });
      }
    }
  }
  return out;
}

function pushRefs(
  acc: Array<{ type: CatalogRelationType; rawRef: string }>,
  type: CatalogRelationType,
  value: unknown,
): void {
  if (typeof value === "string") {
    acc.push({ type, rawRef: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") acc.push({ type, rawRef: v });
    }
  }
}

const INVERSE: Record<string, CatalogRelationType> = {
  dependsOn: "dependencyOf",
  dependencyOf: "dependsOn",
  consumesApi: "apiConsumedBy",
  apiConsumedBy: "consumesApi",
  providesApi: "apiProvidedBy",
  apiProvidedBy: "providesApi",
  partOf: "hasPart",
  hasPart: "partOf",
  memberOf: "hasMember",
  hasMember: "memberOf",
  ownerOf: "ownedBy",
  ownedBy: "ownerOf",
};

function inverseType(type: string): CatalogRelationType {
  return INVERSE[type] ?? (type as CatalogRelationType);
}

export async function getRelationsFor(entityId: string): Promise<CatalogRelationsResponse> {
  const entity = await prisma.catalogEntity.findUnique({ where: { id: entityId } });
  if (!entity) return { outgoing: [], incoming: [] };

  // One findMany + Map beats per-ref lookups; incoming-edge scanning needs every yamlSpec anyway (<500 entities by design).
  const all = await prisma.catalogEntity.findMany({
    select: { id: true, name: true, kind: true, lifecycle: true, yamlSpec: true },
  });
  const byKey = new Map<string, (typeof all)[number]>();
  const byName = new Map<string, Array<(typeof all)[number]>>();
  for (const e of all) {
    byKey.set(`${e.kind}::${e.name}`, e);
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }

  function resolve(rawRef: string): CatalogRelation["target"] {
    const { kind, name } = parseRef(rawRef);
    if (kind) {
      const hit = byKey.get(`${kind}::${name}`);
      if (hit) return { id: hit.id, name: hit.name, kind: hit.kind, lifecycle: hit.lifecycle };
      return null;
    }
    // No kind is ambiguous; resolve only when exactly one entity has this name.
    const candidates = byName.get(name) ?? [];
    if (candidates.length === 1) {
      const c = candidates[0]!;
      return { id: c.id, name: c.name, kind: c.kind, lifecycle: c.lifecycle };
    }
    return null;
  }

  const outgoing: CatalogRelation[] = readOutgoing(entity.yamlSpec).map(({ type, rawRef }) => ({
    type,
    rawRef,
    target: resolve(rawRef),
  }));

  // Incoming: scan every other entity's outgoing edges, keep ones pointing here.
  const incoming: CatalogRelation[] = [];
  for (const other of all) {
    if (other.id === entity.id) continue;
    for (const edge of readOutgoing(other.yamlSpec)) {
      const target = resolve(edge.rawRef);
      if (target?.id !== entity.id) continue;
      incoming.push({
        type: inverseType(edge.type),
        rawRef: `${other.kind}:${other.name}`,
        target: { id: other.id, name: other.name, kind: other.kind, lifecycle: other.lifecycle },
      });
    }
  }

  return { outgoing, incoming };
}
