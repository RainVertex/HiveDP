// Express CRUD and evaluation routes for scorecards.

import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@internal/db";
import { evaluateAllScorecards } from "./evaluator";

const TIER_STYLE = z.enum(["stage", "threshold"]);
const KIND = z.enum(["service", "api", "library", "website", "database", "infrastructure"]);

const ruleInput = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "field_present",
    "has_owner",
    "lifecycle_in",
    "tag_present",
    "dora_threshold",
    "drift_count_max",
  ]),
  config: z.record(z.string(), z.unknown()),
  weight: z.number().int().min(1).max(10).optional(),
  tier: z.enum(["bronze", "silver", "gold", "red", "orange", "yellow", "green"]),
});

const createInput = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, and dashes"),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  appliesTo: z.array(KIND).optional(),
  tierStyle: TIER_STYLE,
  enabled: z.boolean().optional(),
  rules: z.array(ruleInput).optional(),
});

const patchInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  appliesTo: z.array(KIND).optional(),
  tierStyle: TIER_STYLE.optional(),
  enabled: z.boolean().optional(),
  rules: z.array(ruleInput).optional(),
});

export const scorecardsRouter: Router = Router();

scorecardsRouter.get("/", async (_req, res) => {
  const items = await prisma.scorecard.findMany({
    orderBy: { name: "asc" },
    include: { rules: { orderBy: { tier: "asc" } } },
  });
  res.json({ items });
});

scorecardsRouter.get("/:id", async (req, res) => {
  const sc = await prisma.scorecard.findUnique({
    where: { id: req.params.id },
    include: { rules: { orderBy: { tier: "asc" } } },
  });
  if (!sc) return res.status(404).json({ error: "Scorecard not found" });
  res.json(sc);
});

scorecardsRouter.post("/", async (req, res) => {
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { rules, ...data } = parsed.data;
  try {
    const created = await prisma.scorecard.create({
      data: {
        ...data,
        appliesTo: data.appliesTo ?? [],
        rules: rules
          ? { create: rules.map((r) => ({ ...r, config: r.config as Prisma.InputJsonValue })) }
          : undefined,
      },
      include: { rules: true },
    });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Slug already in use" });
    }
    throw err;
  }
});

scorecardsRouter.patch("/:id", async (req, res) => {
  const parsed = patchInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const existing = await prisma.scorecard.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Scorecard not found" });

  const { rules, ...data } = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    const sc = await tx.scorecard.update({ where: { id: existing.id }, data });
    if (rules) {
      // Replace-all: delete existing rules, recreate from input.
      await tx.scorecardRule.deleteMany({ where: { scorecardId: existing.id } });
      if (rules.length > 0) {
        await tx.scorecardRule.createMany({
          data: rules.map((r) => ({
            scorecardId: existing.id,
            ...r,
            config: r.config as Prisma.InputJsonValue,
          })),
        });
      }
    }
    return tx.scorecard.findUnique({
      where: { id: sc.id },
      include: { rules: { orderBy: { tier: "asc" } } },
    });
  });
  res.json(updated);
});

scorecardsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.scorecard.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Scorecard not found" });
  await prisma.scorecard.delete({ where: { id: existing.id } });
  res.status(204).end();
});

scorecardsRouter.post("/:id/evaluate", async (req, res) => {
  const existing = await prisma.scorecard.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Scorecard not found" });
  // v1 has few scorecards, so just run the full evaluator to stay consistent with the scheduled job.
  const result = await evaluateAllScorecards();
  res.json(result);
});
