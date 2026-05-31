// Scaffolder action that walks a repo for catalog-info.yaml and upserts each entity.
import { z } from "zod";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";
import { discoverAndPersist } from "../services/catalog-discovery";

const catalogDiscoverInput = z.object({
  source: z.enum(["github", "local"]).default("github"),
  /** "owner/repo" for source=github, absolute path for source=local. */
  target: z.string().min(1),
  /** Git ref for source=github. */
  ref: z.string().optional(),
  /** Secret name holding the GitHub token. */
  tokenSecret: z.string().default("GITHUB_TOKEN"),
});

type CatalogDiscoverInput = z.infer<typeof catalogDiscoverInput>;

export interface CatalogDiscoverOutput {
  source: "github" | "local";
  target: string;
  ref: string | null;
  filesFound: number;
  created: number;
  updated: number;
  noop: number;
  errors: number;
  entityIds: string[];
}

export const catalogDiscoverAction: Action<CatalogDiscoverInput, CatalogDiscoverOutput> = {
  id: "catalog:discover",
  description:
    "Walk a repo for catalog-info.yaml and upsert each entity through the shared catalog service.",
  schema: catalogDiscoverInput,
  // Capabilities mirror what registerCatalogEntity actually does.
  capabilities: ["repo:read", "db:write:catalog"],
  // Non-idempotent here (update decision lives in the shared service), so always "absent" so plan() never short-circuits.
  async match(_input, _ctx: ReadCtx) {
    return "absent";
  },
  async diff(input) {
    return [
      {
        kind: "catalog.discover" as never,
        source: input.source,
        target: input.target,
      } as never,
    ];
  },
  async apply(input, ctx: WriteCtx) {
    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] catalog:discover ${input.source}:${input.target}`);
      return {
        output: {
          source: input.source,
          target: input.target,
          ref: input.ref ?? null,
          filesFound: 0,
          created: 0,
          updated: 0,
          noop: 0,
          errors: 0,
          entityIds: [],
        },
        compensation: { kind: "noop", reason: "dry run" },
      };
    }

    const token =
      input.source === "github" ? (ctx.secrets.tryRead(input.tokenSecret) ?? undefined) : undefined;
    const result = await discoverAndPersist({
      source: input.source,
      target: input.target,
      ref: input.ref,
      tokenSecret: input.tokenSecret,
      token,
    });

    ctx.logger.info(
      `catalog:discover ${input.source}:${input.target}@${result.ref ?? "?"}: ` +
        `created=${result.created} updated=${result.updated} noop=${result.noop} errors=${result.errors.length}`,
    );

    return {
      output: {
        source: result.source,
        target: result.target,
        ref: result.ref,
        filesFound: result.filesFound.length,
        created: result.created,
        updated: result.updated,
        noop: result.noop,
        errors: result.errors.length,
        entityIds: result.entityIds,
      },
      // Shared service records compensation per entity, this layer can't unwind a partial sweep safely.
      compensation: { kind: "noop", reason: "discovery results recorded individually" },
    };
  },
};

export { catalogDiscoverInput };
