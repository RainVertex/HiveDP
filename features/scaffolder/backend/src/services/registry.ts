// Lazily builds and caches the scaffolder action registry and the merged template registry.
import {
  createActionRegistry,
  createTemplateRegistry,
  debugLogAction,
  fetchTemplateAction,
  fsDeleteAction,
  fsRenameAction,
  fsWriteAction,
  type ActionRegistry,
  type TemplateRegistry,
} from "@internal/scaffolder-core";
import { githubServiceTemplate } from "@internal/scaffolder-templates";
import { prisma } from "@internal/db";
import { catalogRegisterAction } from "../actions/catalog";
import { catalogDiscoverAction } from "../actions/catalog-discover";
import { bindingWriteAction } from "../actions/binding";
import { publishGithubAction } from "../actions/publish-github";
import { publishGithubPrAction } from "../actions/publish-github-pr";
import { compileTemplateDef, templateDefSchema } from "./template-defs";

let actionsCache: ActionRegistry | null = null;
let templatesCache: TemplateRegistry | null = null;
let templatesCacheAt = 0;
let templatesDirty = false;

// DB-defined templates refresh on CRUD invalidation, the TTL covers other instances.
const TEMPLATE_CACHE_TTL_MS = 30_000;

const CODE_TEMPLATES = [githubServiceTemplate];

export function builtInTemplateIds(): string[] {
  return CODE_TEMPLATES.map((t) => t.metadata.id);
}

export function getActionRegistry(): ActionRegistry {
  if (actionsCache) return actionsCache;
  const actions = createActionRegistry();
  actions.registerMany([
    debugLogAction,
    fsWriteAction,
    fsDeleteAction,
    fsRenameAction,
    fetchTemplateAction,
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
  for (const template of CODE_TEMPLATES) registry.register(template);

  const rows = await prisma.scaffoldTemplateDef.findMany({ where: { enabled: true } });
  for (const row of rows) {
    const parsed = templateDefSchema.safeParse(row.definition);
    // Broken or colliding rows are skipped, built-in templates win on id collision.
    if (!parsed.success) continue;
    if (registry.get(parsed.data.identifier)) continue;
    registry.register(compileTemplateDef(parsed.data));
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
