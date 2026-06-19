// Lets each feature backend declare how it mounts onto the api shell, so apps/api can wire features in
// a stable loop instead of a hand-edited list. A feature owns its own mount paths, order, and auth phase.
import type { Router } from "express";

// raw: mounted before express.json (the router needs the unparsed request body, e.g. HMAC webhooks).
// preApi: mounted after json parsing but outside the /api session-auth chain (e.g. bearer-token MCP).
// api (default): mounted under the shared "/api" requireAuth + rate-limit chain.
export type MountPhase = "raw" | "preApi" | "api";

export interface FeatureMount {
  path: string;
  router: Router;
  phase?: MountPhase;
  // Lower mounts first within a phase. Use to keep a specific subrouter ahead of a catch-all on the same prefix.
  order?: number;
}

export interface FeatureManifest {
  mounts?: FeatureMount[];
  // Boot-time side effects (e.g. registering tools into a shared registry) run once before listen.
  onBoot?: () => void;
}

export interface FeatureHostContext {
  liveRepoRoot: string;
}

// A feature exports either a static manifest or a factory when it needs shell context (e.g. liveRepoRoot).
export type FeatureManifestSource =
  | FeatureManifest
  | ((ctx: FeatureHostContext) => FeatureManifest);

export function resolveManifest(
  source: FeatureManifestSource,
  ctx: FeatureHostContext,
): FeatureManifest {
  return typeof source === "function" ? source(ctx) : source;
}

// Normalizes a registry into resolved manifests plus mounts grouped by phase and sorted by order.
// Sort is stable, so two mounts with the same order keep their declaration sequence.
export function collectMounts(sources: FeatureManifestSource[], ctx: FeatureHostContext) {
  const manifests = sources.map((source) => resolveManifest(source, ctx));
  const mountsByPhase: Record<MountPhase, FeatureMount[]> = { raw: [], preApi: [], api: [] };
  for (const manifest of manifests) {
    for (const mount of manifest.mounts ?? []) mountsByPhase[mount.phase ?? "api"].push(mount);
  }
  for (const phase of Object.keys(mountsByPhase) as MountPhase[]) {
    mountsByPhase[phase].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  return { manifests, mountsByPhase };
}
