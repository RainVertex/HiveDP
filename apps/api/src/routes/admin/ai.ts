import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  ActiveChatModelDto,
} from "@internal/shared-types";
import {
  getSetting,
  setSetting,
  clearSetting,
  isProviderReady,
  getProviderIdsWithStoredKey,
  providerHasStoredKey,
  setProviderKey,
  clearProviderKey,
} from "@internal/llm-core";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";

// Admin "AI / Models" routes: provider/model readiness, enable/disable, active chat model selection, and provider key management.

export const adminAiRouter = Router();

adminAiRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const ACTIVE_KEY = "chat.activeModelId";
const VISION_KEY = "chat.visionModelId";

adminAiRouter.get("/models", async (_req, res, next) => {
  try {
    const activeChatModelId = await getSetting<string>(ACTIVE_KEY);
    const activeVisionModelId = await getSetting<string>(VISION_KEY);
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
        enabled: m.enabled,
        isActiveChatModel: m.id === activeChatModelId,
        isActiveVisionModel: m.id === activeVisionModelId,
      })),
    }));
    const body: AdminAiModelsResponse = {
      providers: groups,
      activeChatModelId: activeChatModelId ?? null,
      activeVisionModelId: activeVisionModelId ?? null,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

const patchModelSchema = z.object({ enabled: z.boolean() });

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
    if (!parsed.data.enabled) {
      const active = await getSetting<string>(ACTIVE_KEY);
      if (active === id) {
        res.status(409).json({
          error: "This model is the active chat model. Select another active model first.",
          code: "active_model_in_use",
        });
        return;
      }
      const activeVision = await getSetting<string>(VISION_KEY);
      if (activeVision === id) {
        res.status(409).json({
          error: "This model is the active vision model. Select another vision model first.",
          code: "active_model_in_use",
        });
        return;
      }
    }
    await prisma.llmModel.update({ where: { id }, data: { enabled: parsed.data.enabled } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminAiRouter.get("/active-chat-model", async (_req, res, next) => {
  try {
    const modelId = await getSetting<string>(ACTIVE_KEY);
    const body: ActiveChatModelDto = { modelId: modelId ?? null };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

const putActiveSchema = z.object({ modelId: z.string().nullable() });

adminAiRouter.put("/active-chat-model", async (req, res, next) => {
  try {
    const parsed = putActiveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { modelId } = parsed.data;
    if (modelId === null) {
      await clearSetting(ACTIVE_KEY);
      res.status(204).end();
      return;
    }
    const model = await prisma.llmModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    });
    if (!model) {
      res.status(400).json({ error: "Model not found", code: "model_not_found" });
      return;
    }
    if (!model.enabled) {
      res.status(400).json({ error: "Model is disabled", code: "model_disabled" });
      return;
    }
    if (!model.provider.enabled) {
      res.status(400).json({ error: "Provider is disabled", code: "provider_disabled" });
      return;
    }
    const hasStoredKey = await providerHasStoredKey(model.provider.id);
    if (!isProviderReady(model.provider, hasStoredKey)) {
      res.status(400).json({
        error: `Provider is not ready (no in-app key and ${model.provider.apiKeyEnvVar} is unset)`,
        code: "provider_not_ready",
      });
      return;
    }
    if (!model.supportsTools) {
      res.status(400).json({
        error: "The chat assistant needs a tool-capable model.",
        code: "model_lacks_tools",
      });
      return;
    }
    await setSetting(ACTIVE_KEY, model.id, req.user?.id ?? null);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminAiRouter.get("/active-vision-model", async (_req, res, next) => {
  try {
    const modelId = await getSetting<string>(VISION_KEY);
    const body: ActiveChatModelDto = { modelId: modelId ?? null };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

adminAiRouter.put("/active-vision-model", async (req, res, next) => {
  try {
    const parsed = putActiveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { modelId } = parsed.data;
    if (modelId === null) {
      await clearSetting(VISION_KEY);
      res.status(204).end();
      return;
    }
    const model = await prisma.llmModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    });
    if (!model) {
      res.status(400).json({ error: "Model not found", code: "model_not_found" });
      return;
    }
    if (!model.enabled) {
      res.status(400).json({ error: "Model is disabled", code: "model_disabled" });
      return;
    }
    if (!model.provider.enabled) {
      res.status(400).json({ error: "Provider is disabled", code: "provider_disabled" });
      return;
    }
    const hasStoredKey = await providerHasStoredKey(model.provider.id);
    if (!isProviderReady(model.provider, hasStoredKey)) {
      res.status(400).json({
        error: `Provider is not ready (no in-app key and ${model.provider.apiKeyEnvVar} is unset)`,
        code: "provider_not_ready",
      });
      return;
    }
    if (!model.supportsVision) {
      res.status(400).json({
        error: "Image extraction needs a vision-capable model.",
        code: "model_lacks_vision",
      });
      return;
    }
    await setSetting(VISION_KEY, model.id, req.user?.id ?? null);
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
