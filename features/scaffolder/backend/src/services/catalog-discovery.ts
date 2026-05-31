// Discovers catalog-info.yaml from local fs or GitHub and persists entities via the shared catalog service.
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { Octokit as OctokitClient } from "octokit";
import {
  CATALOG_INFO_FILE_NAMES,
  parseCatalogInfo,
  registerCatalogEntity,
  type RegisterCatalogEntityInput,
} from "@feature/catalog-backend";

// octokit v5 is ESM-only and the api backend is CJS, so defer the load to avoid breaking Node's CJS loader.
async function loadOctokit(): Promise<typeof OctokitClient> {
  const mod = await import("octokit");
  return mod.Octokit;
}

export interface DiscoveryInput {
  source: "github" | "local";
  /** "org/repo" for github, absolute path for local. */
  target: string;
  ref?: string;
  tokenSecret?: string;
  token?: string;
}

export interface DiscoveredEntity {
  input: RegisterCatalogEntityInput;
  yamlSpec: unknown;
  yamlPath: string;
}

export interface DiscoveryResult {
  source: "github" | "local";
  target: string;
  ref: string | null;
  filesFound: string[];
  parsed: DiscoveredEntity[];
  parseErrors: Array<{ path: string; reason: string }>;
}

export async function discoverCatalogYaml(input: DiscoveryInput): Promise<DiscoveryResult> {
  if (input.source === "local") {
    return readLocal(input.target);
  }
  return readGithub(input);
}

async function readLocal(rootPath: string): Promise<DiscoveryResult> {
  const out: DiscoveryResult = {
    source: "local",
    target: rootPath,
    ref: null,
    filesFound: [],
    parsed: [],
    parseErrors: [],
  };
  const root = resolve(rootPath);
  for (const name of CATALOG_INFO_FILE_NAMES) {
    const full = join(root, name);
    let raw: string;
    try {
      raw = await fs.readFile(full, "utf8");
    } catch {
      continue;
    }
    out.filesFound.push(name);
    const parsed = parseCatalogInfo(name, raw);
    if (parsed.kind === "error") out.parseErrors.push({ path: name, reason: parsed.reason });
    else out.parsed.push({ input: parsed.input, yamlSpec: parsed.yamlSpec, yamlPath: name });
  }
  return out;
}

async function readGithub(input: DiscoveryInput): Promise<DiscoveryResult> {
  const [owner, repo] = input.target.split("/");
  if (!owner || !repo) {
    throw new Error(`github target must be "owner/repo", got "${input.target}"`);
  }
  const Octokit = await loadOctokit();
  const octo = new Octokit(input.token ? { auth: input.token } : {});
  let ref = input.ref;
  if (!ref) {
    const meta = await octo.rest.repos.get({ owner, repo });
    ref = meta.data.default_branch;
  }
  const out: DiscoveryResult = {
    source: "github",
    target: input.target,
    ref,
    filesFound: [],
    parsed: [],
    parseErrors: [],
  };
  for (const name of CATALOG_INFO_FILE_NAMES) {
    let raw: string;
    try {
      const res = await octo.rest.repos.getContent({ owner, repo, path: name, ref });
      const data = res.data as { type?: string; encoding?: string; content?: string };
      if (data.type !== "file" || data.encoding !== "base64" || !data.content) continue;
      raw = Buffer.from(data.content, "base64").toString("utf8");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) continue;
      out.parseErrors.push({ path: name, reason: (err as Error).message });
      continue;
    }
    out.filesFound.push(name);
    const parsed = parseCatalogInfo(name, raw);
    if (parsed.kind === "error") out.parseErrors.push({ path: name, reason: parsed.reason });
    else out.parsed.push({ input: parsed.input, yamlSpec: parsed.yamlSpec, yamlPath: name });
  }
  return out;
}

export interface DiscoverAndPersistResult {
  source: "github" | "local";
  target: string;
  ref: string | null;
  filesFound: string[];
  created: number;
  updated: number;
  noop: number;
  errors: Array<{ path: string; reason: string }>;
  entityIds: string[];
}

/** High-level entry point: discover + write through the shared catalog service. */
export async function discoverAndPersist(input: DiscoveryInput): Promise<DiscoverAndPersistResult> {
  const discovered = await discoverCatalogYaml(input);
  const out: DiscoverAndPersistResult = {
    source: discovered.source,
    target: discovered.target,
    ref: discovered.ref,
    filesFound: discovered.filesFound,
    created: 0,
    updated: 0,
    noop: 0,
    errors: [...discovered.parseErrors],
    entityIds: [],
  };
  const sourceRef = discovered.ref
    ? `${discovered.source}:${discovered.target}@${discovered.ref}`
    : `${discovered.source}:${discovered.target}`;
  for (const entity of discovered.parsed) {
    try {
      const result = await registerCatalogEntity(
        { ...entity.input, yamlSpec: entity.yamlSpec as never },
        { source: "discovery", sourceRef },
      );
      out.entityIds.push(result.entityId);
      if (result.action === "created") out.created++;
      else if (result.action === "updated") out.updated++;
      else out.noop++;
    } catch (err) {
      out.errors.push({ path: entity.yamlPath, reason: (err as Error).message });
    }
  }
  return out;
}

/** Parse "https://github.com/org/repo[.git]" into { owner, repo } or null. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}
