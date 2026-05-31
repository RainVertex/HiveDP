// Admin routes to list, mint, and revoke scaffolder MCP tokens, with audit logging.
import { Router } from "express";
import { z } from "zod";
import { listAllMcpTokens, mintMcpToken, revokeMcpToken } from "@feature/scaffolder-backend";
import { requireAuth, requireRole } from "../../middleware/requireAuth";
import { adminLimiter } from "../../middleware/rateLimit";
import { recordSystemAudit } from "../../audit/audit";

export const adminScaffolderMcpTokensRouter: Router = Router();

adminScaffolderMcpTokensRouter.use(adminLimiter, requireAuth, requireRole("admin"));

const mintSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(80),
  scopes: z.array(z.string().min(1)).default(["*"]),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 365)
    .default(60 * 60 * 24 * 90),
});

adminScaffolderMcpTokensRouter.get("/", async (_req, res, next) => {
  try {
    const items = await listAllMcpTokens();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

adminScaffolderMcpTokensRouter.post("/", async (req, res, next) => {
  try {
    const parsed = mintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const minted = await mintMcpToken(parsed.data);
    await recordSystemAudit(
      "scaffolder.mcp_token.minted",
      {
        tokenId: minted.id,
        forUserId: parsed.data.userId,
        scopes: parsed.data.scopes,
        expiresAt: minted.expiresAt.toISOString(),
      },
      { kind: "scaffolder.mcp_token", id: minted.id },
      {
        actorUserId: req.user?.id ?? null,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
      },
    );
    // Cleartext token is returned exactly once; the DB only stores the sha256 hash.
    res.status(201).json({
      id: minted.id,
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

adminScaffolderMcpTokensRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Missing token id" });
      return;
    }
    const ok = await revokeMcpToken(id);
    if (!ok) {
      res.status(404).json({ error: "Token not found" });
      return;
    }
    await recordSystemAudit(
      "scaffolder.mcp_token.revoked",
      { tokenId: id },
      { kind: "scaffolder.mcp_token", id },
      {
        actorUserId: req.user?.id ?? null,
        actorIp: req.ip ?? null,
        requestId: req.id != null ? String(req.id) : null,
      },
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
