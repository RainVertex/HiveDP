// Pure logic for deciding where an entity's docs live (spec override, /docs dir, README, or none).
import type { DocResolvedSource } from "@internal/shared-types";

interface EntityForResolve {
  repoUrl: string | null;
  yamlSpec: unknown;
}

export function readSpecDocs(entity: EntityForResolve): DocResolvedSource | null {
  const yaml = entity.yamlSpec as Record<string, unknown> | null | undefined;
  const spec = yaml?.spec as Record<string, unknown> | undefined;
  const docs = spec?.docs as Record<string, unknown> | undefined;
  if (!docs) return null;

  const url = typeof docs.url === "string" ? docs.url.trim() : "";
  if (url && /^https?:\/\//i.test(url)) {
    return { kind: "spec-url", url };
  }

  const path = typeof docs.path === "string" ? docs.path.trim() : "";
  if (path) {
    return { kind: "spec-path", path: normalizePath(path) };
  }

  return null;
}

export function normalizePath(input: string): string {
  let p = input.replace(/\\/g, "/").trim();
  if (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export interface ResolveProbes {
  hasDocsDir: boolean;
  hasReadme: boolean;
}

export function resolveDocSource(
  entity: EntityForResolve,
  probes: ResolveProbes,
): DocResolvedSource {
  const spec = readSpecDocs(entity);
  if (spec) return spec;
  if (!entity.repoUrl) return { kind: "none" };
  if (probes.hasDocsDir) return { kind: "docs-dir", path: "docs" };
  if (probes.hasReadme) return { kind: "readme", path: "README.md" };
  return { kind: "none" };
}

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}
