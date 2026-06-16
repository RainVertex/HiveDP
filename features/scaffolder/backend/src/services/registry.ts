// Lazily builds and caches the scaffolder action registry and the YAML-backed template registry.
import {
  createActionRegistry,
  createTemplateRegistry,
  debugLogAction,
  fsDeleteAction,
  fsRenameAction,
  fsWriteAction,
  type ActionRegistry,
  type TemplateRegistry,
} from "@internal/scaffolder-core";
import { prisma } from "@internal/db";
import { catalogRegisterAction } from "../actions/catalog";
import { catalogDiscoverAction } from "../actions/catalog-discover";
import { fetchRemoteTemplateAction } from "../actions/fetch-remote-template";
import { bindingWriteAction } from "../actions/binding";
import { publishGithubAction } from "../actions/publish-github";
import { publishGithubPrAction } from "../actions/publish-github-pr";
import { validateTemplateSource } from "./template-defs";

let actionsCache: ActionRegistry | null = null;
let templatesCache: TemplateRegistry | null = null;
let templatesCacheAt = 0;
let templatesDirty = false;

// DB-defined templates refresh on CRUD invalidation, the TTL covers other instances.
const TEMPLATE_CACHE_TTL_MS = 30_000;

export function getActionRegistry(): ActionRegistry {
  if (actionsCache) return actionsCache;
  const actions = createActionRegistry();
  actions.registerMany([
    debugLogAction,
    fsWriteAction,
    fsDeleteAction,
    fsRenameAction,
    fetchRemoteTemplateAction,
    catalogRegisterAction,
    catalogDiscoverAction,
    bindingWriteAction,
    publishGithubAction,
    publishGithubPrAction,
  ]);
  actionsCache = actions;
  return actions;
}

export function invalidateTemplateCache(): void {
  templatesDirty = true;
}

export async function getTemplates(): Promise<TemplateRegistry> {
  const fresh =
    templatesCache && !templatesDirty && Date.now() - templatesCacheAt < TEMPLATE_CACHE_TTL_MS;
  if (fresh) return templatesCache!;

  const registry = createTemplateRegistry();
  const actions = getActionRegistry();
  const rows = await prisma.scaffoldTemplateDef.findMany({ where: { enabled: true } });
  for (const row of rows) {
    try {
      const { compiled } = validateTemplateSource(row.source, actions);
      if (registry.get(compiled.metadata.id)) continue;
      registry.register(compiled);
    } catch {
      // Broken rows are skipped, the editor surfaces their validation errors.
    }
  }

  templatesCache = registry;
  templatesCacheAt = Date.now();
  templatesDirty = false;
  return registry;
}

// Test-only, drops the singletons so a fresh registry avoids cross-suite pollution.
export function resetRegistries(): void {
  actionsCache = null;
  templatesCache = null;
  templatesCacheAt = 0;
  templatesDirty = false;
}
