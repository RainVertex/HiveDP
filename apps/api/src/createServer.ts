// Builds the Express app: tool registration, CORS, body parsing, and all route mounts.
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { registerHealthRoute } from "./routes/health";
import { errorHandler } from "./middleware/errorHandler";
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
import { agentsRouter, llmRouter, registerAgentTools } from "@feature/agents-backend";
import { chatRouter, registerChatTools } from "@feature/chat-backend";
import {
  catalogRouter,
  devdocsRouter,
  githubAppWebhookRouter,
  githubWebhookRouter,
  scorecardsRouter,
} from "@feature/catalog-backend";
import { doraMetricsRouter } from "@feature/dora-metrics-backend";
import { integrationsRouter } from "@feature/integrations-backend";
import { githubIntegrationRouter } from "./routes/integrations/github";
import { grafanaWebhookRouter, observabilityRouter } from "@feature/observability-backend";
import { notificationsRouter } from "@feature/notifications-backend";
import { onboardingRouter } from "@feature/onboarding-backend";
import { pagesRouter } from "@feature/pages-backend";
import { projectsRouter } from "@feature/projects-backend";
import { createScaffolderMcpRouter, createScaffolderRouter } from "@feature/scaffolder-backend";
import { searchRouter } from "@feature/search-backend";
import { requestsRouter } from "@feature/requests-backend";
import {
  maintainerRequestsRouter,
  teamPoliciesRouter,
  teamRequestsRouter,
  teamsRouter,
} from "@feature/teams-backend";
import { webhooksRouter } from "@feature/webhooks-backend";

export function createServer() {
  const env = loadEnv();
  // Register tools into the shared llm-core registry at boot so resolveTools() can find them.
  registerAgentTools();
  registerChatTools();
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.webOrigin,
      credentials: true,
    }),
  );

  // Mounted before express.json() because HMAC signature verification needs the raw body.
  app.use("/integrations/github/webhook", githubWebhookRouter);

  // Separate path so the App-wide secret is verified independently of the per-repo webhook above.
  app.use("/integrations/github/app-webhook", githubAppWebhookRouter);

  // Raw body needed for the Bearer-token check and replay protection (body parsed after auth).
  app.use("/integrations/grafana/webhook", grafanaWebhookRouter);

  app.use(express.json());
  app.use(cookieParser(env.sessionSecret));

  registerHealthRoute(app);

  app.use("/auth", authRouter);

  // Bearer-token auth (not session cookie), so it sits outside the /api requireAuth and apiLimiter chain.
  app.use(
    "/mcp/scaffolder",
    createScaffolderMcpRouter({ liveRepoRoot: resolve(__dirname, "../../..") }),
  );

  app.use("/api", apiLimiter, requireAuth);

  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/ai", adminAiRouter);
  app.use("/api/admin/audit", adminAuditRouter);
  app.use("/api/admin/jobs", adminJobsRouter);
  app.use("/api/admin/scaffolder/mcp-tokens", adminScaffolderMcpTokensRouter);
  app.use("/api/admin/scaffolder/access-requests", adminScaffolderAccessRequestsRouter);
  app.use("/api/admin/scaffolder/templates", adminScaffolderTemplateAclsRouter);
  app.use("/api/departments", departmentsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/llm", llmRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/devdocs", devdocsRouter);
  app.use("/api/scorecards", scorecardsRouter);
  app.use("/api/dora-metrics", doraMetricsRouter);
  // Mounted before the catch-all integrations router so its routes aren't shadowed.
  app.use("/api/integrations/github", githubIntegrationRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/observability", observabilityRouter);
  // Mounted before the catch-all `/api/scaffolder` so it isn't shadowed.
  app.use("/api/scaffolder/access-requests", scaffolderAccessRequestsRouter);
  app.use(
    "/api/scaffolder",
    createScaffolderRouter({ liveRepoRoot: resolve(__dirname, "../../..") }),
  );
  app.use("/api/users", usersRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/pages", pagesRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/search", searchRouter);
  // Team subrouters mounted before catch-all `/api/teams` so the `/:slug` route doesn't match them.
  app.use("/api/requests", requestsRouter);
  app.use("/api/teams/requests", teamRequestsRouter);
  app.use("/api/teams/maintainer-requests", maintainerRequestsRouter);
  app.use("/api/teams/policies", teamPoliciesRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/webhooks", webhooksRouter);

  app.use(errorHandler);

  return app;
}
