import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type { AdminAiModelsResponse, AdminAiProviderGroup } from "@feature/agents-shared";
import {
  isProviderReady,
  getProviderIdsWithStoredKey,
  setProviderKey,
  clearProviderKey,
  validateProviderKeyFormat,
} from "@internal/llm-core";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";

// Admin "AI / Models" routes: provider/model readiness, enable/disable, and provider key management.
// The chat assistant's model is configured per-agent (Platform Assistant agent's modelId), not here.
// Image input rides on that same model, so there is no separate vision model to select.

export const adminAiRouter = Router();

adminAiRouter.use(adminLimiter, requireAuth, requireRole("admin"));

adminAiRouter.get("/models", async (_req, res, next) => {
  try {
    const storedKeyProviderIds = await getProviderIdsWithStoredKey();
    const providers = await prisma.llmProvider.findMany({
      orderBy: { slug: "asc" },
      include: { models: { orderBy: { slug: "asc" } } },
    });
    const groups: AdminAiProviderGroup[] = providers.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      kind: p.kind,
      hasStoredKey: storedKeyProviderIds.has(p.id),
      ready: isProviderReady(p, storedKeyProviderIds.has(p.id)),
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: p.models.map((m) => ({
        id: m.id,
        slug: m.slug,
        displayName: m.displayName,
        modelName: m.modelName,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsReasoning: m.supportsReasoning,
        dailyTokenCap: m.dailyTokenCap,
        enabled: m.enabled,
      })),
    }));
    const body: AdminAiModelsResponse = { providers: groups };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// dailyTokenCap: a positive integer to cap a model's input+output tokens per UTC day, or null to
// remove the cap. Omitting a field leaves it unchanged.
const patchModelSchema = z
  .object({
    enabled: z.boolean().optional(),
    dailyTokenCap: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => b.enabled !== undefined || b.dailyTokenCap !== undefined, "No fields to update");

adminAiRouter.patch("/models/:id", async (req, res, next) => {
  try {
    const parsed = patchModelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { id } = req.params;
    const model = await prisma.llmModel.findUnique({ where: { id } });
    if (!model) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    const data: { enabled?: boolean; dailyTokenCap?: number | null } = {};
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
    if (parsed.data.dailyTokenCap !== undefined) data.dailyTokenCap = parsed.data.dailyTokenCap;
    await prisma.llmModel.update({ where: { id }, data });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Keys are encrypted at rest, never returned to clients, and take precedence over the provider env var.

const putKeySchema = z.object({ apiKey: z.string().min(1).max(500) });

adminAiRouter.put("/providers/:slug/key", async (req, res, next) => {
  try {
    const parsed = putKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const provider = await prisma.llmProvider.findUnique({ where: { slug: req.params.slug } });
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (!provider.apiKeyEnvVar) {
      res.status(400).json({ error: "This provider needs no API key.", code: "no_key_needed" });
      return;
    }
    const formatError = validateProviderKeyFormat(provider.kind, parsed.data.apiKey);
    if (formatError) {
      res.status(400).json({ error: formatError, code: "invalid_key_format" });
      return;
    }
    try {
      await setProviderKey(provider.id, parsed.data.apiKey.trim(), req.user?.id ?? null);
    } catch (err) {
      // Most likely APP_SECRET_MASTER_KEY is unset; surface the actionable message.
      res.status(500).json({ error: (err as Error).message, code: "encryption_unavailable" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminAiRouter.delete("/providers/:slug/key", async (req, res, next) => {
  try {
    const provider = await prisma.llmProvider.findUnique({ where: { slug: req.params.slug } });
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    await clearProviderKey(provider.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
