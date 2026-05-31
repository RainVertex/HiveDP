// Scaffolder action that upserts the ScaffoldBinding row and writes .platform/binding.yaml.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { prisma } from "@internal/db";
import { stringify as yamlStringify } from "yaml";
import type { Action, ReadCtx, WriteCtx } from "@internal/scaffolder-core";

const bindingWriteInput = z.object({
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  templateHash: z.string().min(1),
  paramsHash: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  targetKind: z.enum(["repo", "feature-dir", "catalog"]),
  targetRef: z.string().min(1),
  /** Repo-relative directory the binding manifest lives in. */
  manifestDir: z.string().min(1),
  ownerTeamId: z.string().optional(),
  catalogEntityId: z.string().optional(),
  branchName: z.string().optional(),
  prUrl: z.string().url().optional(),
  appliedByUserId: z.string().min(1),
});

type BindingWriteInput = z.infer<typeof bindingWriteInput>;

const MANIFEST_FILE = ".platform/binding.yaml";

export const bindingWriteAction: Action<BindingWriteInput, { bindingId: string }> = {
  id: "binding:write",
  description: "Persist the ScaffoldBinding row and write .platform/binding.yaml.",
  schema: bindingWriteInput,
  capabilities: ["fs:write", "fs:write:main", "db:write"],
  async match(input, _ctx: ReadCtx) {
    const existing = await prisma.scaffoldBinding.findUnique({
      where: {
        templateId_targetRef: {
          templateId: input.templateId,
          targetRef: input.targetRef,
        },
      },
      select: { id: true, templateVersion: true, paramsHash: true },
    });
    if (!existing) return "absent";
    return existing.templateVersion === input.templateVersion &&
      existing.paramsHash === input.paramsHash
      ? "match"
      : "drift";
  },
  async diff(input) {
    return [
      {
        kind: "fs.write",
        path: join(input.manifestDir, MANIFEST_FILE),
        contentDiff: {
          before: null,
          after: "(generated binding manifest)",
          patch: `+++ ${join(input.manifestDir, MANIFEST_FILE)}\n+(generated)`,
        },
      },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    const existing = await prisma.scaffoldBinding.findUnique({
      where: {
        templateId_targetRef: {
          templateId: input.templateId,
          targetRef: input.targetRef,
        },
      },
    });

    const manifestPayload = {
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      templateContentHash: input.templateHash,
      paramsHash: input.paramsHash,
      params: input.params,
      appliedAt: new Date().toISOString(),
      appliedBy: input.appliedByUserId,
      bindingId: existing?.id ?? "",
    };

    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] binding:write ${input.templateId} -> ${input.targetRef}`);
      return { output: { bindingId: existing?.id ?? "dry-run" } };
    }

    const upserted = await prisma.scaffoldBinding.upsert({
      where: {
        templateId_targetRef: {
          templateId: input.templateId,
          targetRef: input.targetRef,
        },
      },
      create: {
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        templateHash: input.templateHash,
        paramsHash: input.paramsHash,
        params: input.params as never,
        targetKind: input.targetKind,
        targetRef: input.targetRef,
        target: ctx.target,
        branchName: input.branchName ?? null,
        prUrl: input.prUrl ?? null,
        ownerTeamId: input.ownerTeamId ?? null,
        catalogEntityId: input.catalogEntityId ?? null,
        appliedByUserId: input.appliedByUserId,
      },
      update: {
        templateVersion: input.templateVersion,
        templateHash: input.templateHash,
        paramsHash: input.paramsHash,
        params: input.params as never,
        target: ctx.target,
        branchName: input.branchName ?? null,
        prUrl: input.prUrl ?? null,
        ownerTeamId: input.ownerTeamId ?? null,
        catalogEntityId: input.catalogEntityId ?? null,
      },
    });

    manifestPayload.bindingId = upserted.id;
    const manifestAbs = join(ctx.repoRoot, input.manifestDir, MANIFEST_FILE);
    const previous = await fs.readFile(manifestAbs, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    await fs.mkdir(dirname(manifestAbs), { recursive: true });
    await fs.writeFile(manifestAbs, yamlStringify(manifestPayload), "utf8");
    ctx.logger.info(`binding:write ${input.templateId} -> ${upserted.id}`);

    return {
      output: { bindingId: upserted.id },
      compensation: {
        kind: "repo.restore",
        files: [{ path: join(input.manifestDir, MANIFEST_FILE), previousContent: previous }],
      },
    };
  },
};

export { bindingWriteInput };
