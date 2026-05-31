// Scaffolder template that creates a GitHub repo, pushes a starter scaffold, and registers it in the catalog.
import { z } from "zod";
import { defineTemplate } from "@internal/scaffolder-core";
import { skeletonPath } from "./paths";

const Params = z.object({
  org: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, "must be a valid GitHub login"),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, "must be GitHub-safe"),
  description: z.string().min(1).max(350),
  visibility: z.enum(["public", "private"]).default("private"),
  defaultBranch: z.string().min(1).default("main"),
  ownerTeamId: z.string().min(1).optional(),
});

const TEMPLATE_VERSION = "1.0.0";

export const githubServiceTemplate = defineTemplate({
  metadata: {
    id: "github-service",
    version: TEMPLATE_VERSION,
    name: "GitHub service",
    description:
      "Creates a new GitHub repository, pushes a starter scaffold, and registers it in the catalog.",
    tags: ["service", "github"],
    icon: "rocket",
    audience: ["human", "agent"],
    requiredRole: "member",
    // Out-of-repo target collapses to one value; shape kept consistent so admin overrides stay available.
    defaultTarget: { agent: "worktree", human: "worktree" },
  },
  parameters: Params,
  capabilities: [
    "fs:write",
    "db:write",
    "network:external",
    "repo:public",
    "secrets:read:GITHUB_TOKEN",
  ],
  plan: (params) => [
    {
      action: "fetch:template",
      input: {
        skeletonPath: skeletonPath("github-service"),
        values: {
          name: params.name,
          description: params.description,
          templateVersion: TEMPLATE_VERSION,
        },
      },
    },
    {
      action: "publish:github",
      input: {
        org: params.org,
        name: params.name,
        visibility: params.visibility,
        description: params.description,
        defaultBranch: params.defaultBranch,
      },
    },
    {
      action: "catalog:register",
      input: {
        kind: "service" as const,
        name: params.name,
        description: params.description,
        ownerTeamId: params.ownerTeamId,
        repoUrl: `https://github.com/${params.org}/${params.name}`,
        tags: ["scaffolded", "github"],
      },
    },
  ],
});
