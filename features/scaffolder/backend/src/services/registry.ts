// Lazily builds and caches the scaffolder action and template registries as singletons.
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
import { catalogRegisterAction } from "../actions/catalog";
import { catalogDiscoverAction } from "../actions/catalog-discover";
import { bindingWriteAction } from "../actions/binding";
import { publishGithubAction } from "../actions/publish-github";

let actionsCache: ActionRegistry | null = null;
let templatesCache: TemplateRegistry | null = null;

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
  ]);
  actionsCache = actions;
  return actions;
}

export function getTemplateRegistry(): TemplateRegistry {
  if (templatesCache) return templatesCache;
  const templates = createTemplateRegistry();
  templates.register(githubServiceTemplate);
  templatesCache = templates;
  return templates;
}

// Test-only, drops the singletons so a fresh registry avoids cross-suite pollution.
export function resetRegistries(): void {
  actionsCache = null;
  templatesCache = null;
}
