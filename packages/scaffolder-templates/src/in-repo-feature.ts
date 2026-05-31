// Scaffolder template that adds a new feature module to this monorepo and auto-wires backend/frontend.
import { z } from "zod";
import { defineTemplate, stringHelpers } from "@internal/scaffolder-core";
import { skeletonPath } from "./paths";

const Params = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "feature name must be kebab-case starting with a letter"),
  description: z.string().min(1).optional(),
  ownerTeamId: z.string().min(1).optional(),
});

export const inRepoFeatureTemplate = defineTemplate({
  metadata: {
    id: "in-repo-feature",
    version: "1.0.0",
    name: "In-repo feature module",
    description: "Scaffolds a new feature into this monorepo and auto-wires backend/frontend.",
    tags: ["recommended", "feature", "monorepo"],
    icon: "package",
    audience: ["human", "agent"],
    requiredRole: "member",
  },
  parameters: Params,
  capabilities: ["fs:write", "fs:write:main", "db:write"],
  plan: (params, ctx) => {
    const pascal = ctx.toPascal(params.name);
    const camel = ctx.toCamel(params.name);
    const title = ctx.toTitle(params.name);
    return [
      {
        action: "fetch:template",
        input: {
          skeletonPath: skeletonPath("in-repo-feature"),
          values: {
            name: params.name,
            pascal,
            camel,
            title,
            description: params.description ?? "",
          },
          pathSubstitutions: { __PASCAL__: pascal },
        },
      },
      {
        action: "repo:scaffold",
        input: { targetDir: `features/${params.name}` },
      },
      {
        action: "wire:feature",
        input: { name: params.name },
      },
      {
        action: "wire:sidebar",
        input: { name: params.name, label: title },
      },
      ...(params.ownerTeamId
        ? [
            {
              action: "catalog:register",
              input: {
                kind: "library" as const,
                name: params.name,
                description: params.description,
                ownerTeamId: params.ownerTeamId,
                tags: ["scaffolded", "feature"],
              },
            },
          ]
        : []),
    ];
  },
});

// Exported for tests so they reuse the same string helpers.
export const inRepoFeatureHelpers = {
  pascal: stringHelpers.toPascal,
  camel: stringHelpers.toCamel,
};
