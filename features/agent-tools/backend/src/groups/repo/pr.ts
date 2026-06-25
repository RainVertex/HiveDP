import { parseCatalogInfo, resolveOrgScope } from "@feature/catalog-backend/contract";
import { openOrUpdateFilePr } from "@feature/integrations-backend/contract";
import type { RegisteredTool } from "@internal/llm-core";
import { REPO_OPEN_YAML_PR } from "@feature/agents-shared";
import { loadEntityRepo } from "./resolve";

// The only repo write: open or update the catalog-info.yaml PR on a catalog entity's repo. It is
// entity-scoped (the entity is the only valid target) and writes a fixed, schema-validated file, so
// it takes entityId directly rather than the read tools' target selector.

export const openYamlPr: RegisteredTool = {
  id: REPO_OPEN_YAML_PR,
  openaiDef: {
    type: "function",
    function: {
      name: REPO_OPEN_YAML_PR,
      description:
        "Open (or update) a pull request that writes catalog-info.yaml to a catalog entity's repo. The yaml is validated first; pass the COMPLETE file content. Re-runs update the same branch/PR. Returns { prUrl, prNumber, branchName, action }.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "CatalogEntity.id" },
          yaml: {
            type: "string",
            description:
              "Full catalog-info.yaml content (flat schema: kind, name, description, ownerTeamIds, repoUrl, tags).",
          },
        },
        required: ["entityId", "yaml"],
      },
    },
  },
  handler: async (args, ctx) => {
    const { entityId, yaml } = args as { entityId?: unknown; yaml?: unknown };
    if (typeof yaml !== "string" || !yaml.trim())
      return { error: "yaml required", code: "bad_args" };
    const validated = parseCatalogInfo("catalog-info.yaml", yaml);
    if (validated.kind === "error") {
      return { error: `Invalid catalog-info.yaml: ${validated.reason}`, code: "invalid_yaml" };
    }
    const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
    const repo = await loadEntityRepo(entityId, scope);
    if ("error" in repo) return repo;
    try {
      return await openOrUpdateFilePr({
        installationId: repo.installationId,
        owner: repo.owner,
        repo: repo.repo,
        filePath: "catalog-info.yaml",
        content: yaml.endsWith("\n") ? yaml : `${yaml}\n`,
        branchName: "catalog-info/enricher",
        title: "chore(catalog): add or update catalog-info.yaml",
        body: "Automated by the Catalog Enricher: fills catalog metadata for the developer portal. Review and merge to update the catalog.",
      });
    } catch (err) {
      return { error: (err as Error).message, code: "pr_failed" };
    }
  },
};
