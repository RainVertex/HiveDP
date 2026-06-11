import { z } from "zod";
import { prisma } from "@internal/db";
import { registerCatalogEntity } from "@feature/catalog-backend/contract";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";

const catalogRegisterInput = z.object({
  kind: z
    .enum(["service", "api", "library", "website", "database", "infrastructure"])
    .describe("Catalog entity kind"),
  name: z.string().min(1).describe("Unique entity name, usually the repo name"),
  description: z.string().optional().describe("Entity description"),
  ownerTeamIds: z.array(z.string().min(1)).optional().describe("Owning team ids"),
  repoUrl: z.string().url().optional().describe("Repository URL the entity points at"),
  tags: z.array(z.string()).optional().describe("Catalog tags"),
  accountLogin: z
    .string()
    .min(1)
    .optional()
    .describe("GitHub org login, derived from repoUrl when omitted"),
  githubRepoId: z
    .number()
    .int()
    .optional()
    .describe(
      "GitHub repo id (e.g. steps.publish.output.repoId), converges with webhook discovery on one entity",
    ),
});

type CatalogRegisterInput = z.infer<typeof catalogRegisterInput>;

function accountLoginFromRepoUrl(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) return undefined;
  const match = /^https?:\/\/github\.com\/([^/]+)\//.exec(`${repoUrl}/`);
  return match?.[1];
}

export const catalogRegisterAction: Action<CatalogRegisterInput, { entityId: string }> = {
  id: "catalog:register",
  description:
    "Register the scaffolded artifact in the catalog, converging with webhook discovery on the same entity.",
  schema: catalogRegisterInput,
  capabilities: ["db:write"],
  async match(input, _ctx: ReadCtx) {
    if (input.githubRepoId != null) {
      const byRepoId = await prisma.catalogEntity.findUnique({
        where: { githubRepoId: input.githubRepoId },
        select: { id: true },
      });
      if (byRepoId) return "match";
    }
    const existing = await prisma.catalogEntity.findUnique({
      where: { name_kind: { name: input.name, kind: input.kind } },
      select: { id: true },
    });
    return existing ? "match" : "absent";
  },
  async diff(input) {
    return [
      {
        kind: "catalog.register",
        entity: {
          kind: input.kind,
          name: input.name,
          description: input.description ?? null,
          repoUrl: input.repoUrl ?? null,
          tags: input.tags ?? [],
        },
      },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] catalog:register ${input.kind}/${input.name}`);
      return { output: { entityId: "dry-run" } };
    }
    const { accountLogin: accountLoginInput, githubRepoId, ...entity } = input;
    const accountLogin = accountLoginInput ?? accountLoginFromRepoUrl(input.repoUrl);
    const result = await registerCatalogEntity(
      {
        ...entity,
        ...(accountLogin ? { accountLogin } : {}),
      },
      {
        source: "scaffolder",
        sourceRef: `scaffolder:user/${ctx.actor.userId}`,
        // Scaffolder registration carries intent, the entity is onboarded from the start.
        needsOnboarding: false,
        githubRepoId: githubRepoId ?? null,
      },
    );
    ctx.logger.info(
      `catalog:register ${input.kind}/${input.name} -> ${result.entityId} (${result.action})`,
    );
    if (result.action === "created") {
      return {
        output: { entityId: result.entityId },
        compensation: {
          kind: "db.delete",
          model: "catalogEntity",
          where: { id: result.entityId },
        },
      };
    }
    return {
      output: { entityId: result.entityId },
      compensation: { kind: "noop", reason: `entity already existed (${result.action})` },
    };
  },
};

export { catalogRegisterInput };
