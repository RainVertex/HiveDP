import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  ActiveChatModelDto,
} from "@internal/shared-types";
import { getSetting, setSetting, clearSetting, isProviderReady } from "@internal/llm-core";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";

// Admin "AI / Models" settings. Lists every provider + model with readiness
// (is the API key present) and enabled state, lets an admin enable/disable a
// model, and selects the active chat model. The chat feature reads the active
// model from the SystemSetting "chat.activeModelId"; until one is selected the
// assistant shows the not-configured state.

export const adminAiRouter = Router();

adminAiRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const ACTIVE_KEY = "chat.activeModelId";

adminAiRouter.get("/models", async (_req, res, next) => {
  try {
    const activeChatModelId = await getSetting<string>(ACTIVE_KEY);
    const providers = await prisma.llmProvider.findMany({
      orderBy: { slug: "asc" },
      include: { models: { orderBy: { slug: "asc" } } },
    });
    const groups: AdminAiProviderGroup[] = providers.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      kind: p.kind,
      ready: isProviderReady(p),
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
      })),
    }));
    const body: AdminAiModelsResponse = {
      providers: groups,
      activeChatModelId: activeChatModelId ?? null,
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
    if (!isProviderReady(model.provider)) {
      res.status(400).json({
        error: `Provider is not ready (missing ${model.provider.apiKeyEnvVar})`,
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
