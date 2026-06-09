import { z } from "zod";
import { prisma } from "@internal/db";
import { registerCatalogEntity } from "@feature/catalog-backend/contract";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";

const catalogRegisterInput = z.object({
  kind: z.enum(["service", "api", "library", "website", "database", "infrastructure"]),
  name: z.string().min(1),
  description: z.string().optional(),
  ownerTeamIds: z.array(z.string().min(1)).optional(),
  repoUrl: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
});

type CatalogRegisterInput = z.infer<typeof catalogRegisterInput>;

export const catalogRegisterAction: Action<CatalogRegisterInput, { entityId: string }> = {
  id: "catalog:register",
  description: "Create a CatalogEntity row for the scaffolded artifact.",
  schema: catalogRegisterInput,
  capabilities: ["db:write"],
  async match(input, _ctx: ReadCtx) {
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
    const result = await registerCatalogEntity(input, {
      source: "scaffolder",
      sourceRef: `scaffolder:user/${ctx.actor.userId}`,
    });
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
