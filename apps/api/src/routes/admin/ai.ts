import { Router } from "express";
import { z } from "zod";
import { prisma } from "@internal/db";
import type {
  AdminAiModelsResponse,
  AdminAiProviderGroup,
  ChatSourceRepoDto,
} from "@internal/shared-types";
import {
  getSetting,
  setSetting,
  clearSetting,
  isProviderReady,
  getProviderIdsWithStoredKey,
  setProviderKey,
  clearProviderKey,
} from "@internal/llm-core";
import { isAppConfigured } from "@feature/integrations-backend";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";

// Admin "AI / Models" routes: provider/model readiness, enable/disable, and provider key management.
// The chat assistant's model is configured per-agent (Platform Assistant agent's modelId), not here.
// Image input rides on that same model, so there is no separate vision model to select.

export const adminAiRouter = Router();

adminAiRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const SOURCE_REPO_KEY = "chat.sourceRepo";

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
        enabled: m.enabled,
      })),
    }));
    const body: AdminAiModelsResponse = { providers: groups };
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
    await prisma.llmModel.update({ where: { id }, data: { enabled: parsed.data.enabled } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Source repository the Platform Assistant reads to answer "how does this app work" questions.
// Stored as a SystemSetting so an admin (or a fork operator) can repoint it without a code change.

// Mirrors loadSourceRepoClient in the agent-tools platform-source group, an installation is only
// usable when the App env is configured, otherwise the runtime has no GitHub credentials.
async function resolveCredentialSource(
  owner: string,
): Promise<ChatSourceRepoDto["credentialSource"]> {
  const rows = await prisma.integration.findMany({
    where: { kind: "github", enabled: true },
    select: { config: true },
  });
  const target = owner.toLowerCase();
  let hasInstallation = false;
  for (const row of rows) {
    const cfg = row.config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      const c = cfg as Record<string, unknown>;
      const login = typeof c.accountLogin === "string" ? c.accountLogin.toLowerCase() : "";
      if (login === target && Number.isFinite(Number(c.installationId))) {
        hasInstallation = true;
        break;
      }
    }
  }
  if (hasInstallation && isAppConfigured()) return "github_app";
  return "none";
}

adminAiRouter.get("/source-repo", async (_req, res, next) => {
  try {
    const raw = await getSetting<{ owner?: string; repo?: string; ref?: string | null }>(
      SOURCE_REPO_KEY,
    );
    if (!raw || !raw.owner || !raw.repo) {
      res.json(null);
      return;
    }
    const body: ChatSourceRepoDto = {
      owner: raw.owner,
      repo: raw.repo,
      ref: raw.ref ?? null,
      credentialSource: await resolveCredentialSource(raw.owner),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

const putSourceRepoSchema = z.object({
  owner: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "Invalid GitHub owner"),
  repo: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/, "Invalid GitHub repo name"),
  ref: z.string().min(1).max(100).nullable().optional(),
});

adminAiRouter.put("/source-repo", async (req, res, next) => {
  try {
    const parsed = putSourceRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const { owner, repo } = parsed.data;
    await setSetting(
      SOURCE_REPO_KEY,
      { owner, repo, ref: parsed.data.ref ?? null },
      req.user?.id ?? null,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminAiRouter.delete("/source-repo", async (_req, res, next) => {
  try {
    await clearSetting(SOURCE_REPO_KEY);
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
