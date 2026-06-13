// Builds the Express app: feature boot hooks, CORS, body parsing, and route mounts.
// Feature routes come from featureRegistry; only shell-owned routes are wired by hand here.
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { collectMounts, type FeatureHostContext } from "@internal/feature-host";
import { registerHealthRoute } from "./routes/health";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { requireAuth } from "./middleware/requireAuth";
import { apiLimiter } from "./middleware/rateLimit";
import { loadEnv } from "./config/env";
import { authRouter } from "./auth/routes";
import { adminUsersRouter } from "./routes/admin/users";
import { adminAiRouter } from "./routes/admin/ai";
import { adminAuditRouter } from "./routes/admin/audit";
import { adminJobsRouter } from "./routes/admin/jobs";
import { adminScaffolderMcpTokensRouter } from "./routes/admin/scaffolderMcpTokens";
import { departmentsRouter } from "./routes/departments";
import { scaffolderAccessRequestsRouter } from "./routes/scaffolderAccessRequests";
import { adminScaffolderAccessRequestsRouter } from "./routes/admin/scaffolderAccessRequests";
import { adminScaffolderTemplateAclsRouter } from "./routes/admin/scaffolderTemplateAcls";
import { usersRouter } from "./routes/users";
import { githubIntegrationRouter } from "./routes/integrations/github";
import { featureRegistry } from "./featureRegistry";

export function createServer() {
  const env = loadEnv();
  const ctx: FeatureHostContext = { liveRepoRoot: resolve(__dirname, "../../..") };
  const { manifests, mountsByPhase } = collectMounts(featureRegistry, ctx);

  // Boot-time feature side effects (e.g. registering tools into the shared llm-core registry).
  for (const manifest of manifests) manifest.onBoot?.();

  const app = express();

  app.set("trust proxy", 1);

  // Assigns req.id (honoring an inbound x-request-id) so audit events can correlate to a request.
  app.use(requestId);

  app.use(
    cors({
      origin: env.webOrigin,
      credentials: true,
    }),
  );

  // Raw-body feature routes (HMAC webhooks) mount before express.json since they need the exact bytes.
  for (const mount of mountsByPhase.raw) app.use(mount.path, mount.router);

  // Chat accepts base64 image attachments, so it needs a larger limit than the global 100kb parser below.
  app.use("/api/chat", express.json({ limit: "10mb" }));
  app.use(express.json());
  app.use(cookieParser(env.sessionSecret));

  registerHealthRoute(app);

  app.use("/auth", authRouter);

  // Feature routes that run their own auth (e.g. MCP bearer token), outside the /api session chain.
  for (const mount of mountsByPhase.preApi) app.use(mount.path, mount.router);

  app.use("/api", apiLimiter, requireAuth);

  // Shell-owned /api routers, mounted before feature routers so the more-specific shell paths
  // (e.g. /api/integrations/github, /api/scaffolder/access-requests) win over feature catch-alls.
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/ai", adminAiRouter);
  app.use("/api/admin/audit", adminAuditRouter);
  app.use("/api/admin/jobs", adminJobsRouter);
  app.use("/api/admin/scaffolder/mcp-tokens", adminScaffolderMcpTokensRouter);
  app.use("/api/admin/scaffolder/access-requests", adminScaffolderAccessRequestsRouter);
  app.use("/api/admin/scaffolder/templates", adminScaffolderTemplateAclsRouter);
  app.use("/api/departments", departmentsRouter);
  app.use("/api/integrations/github", githubIntegrationRouter);
  app.use("/api/scaffolder/access-requests", scaffolderAccessRequestsRouter);
  app.use("/api/users", usersRouter);

  // Feature /api routers, each ordered by its featureManifest (subrouters before catch-alls).
  for (const mount of mountsByPhase.api) app.use(mount.path, mount.router);

  app.use(errorHandler);

  return app;
}
