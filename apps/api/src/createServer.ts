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
import { oidcRouter } from "./oidc";
import { adminUsersRouter } from "./routes/admin/users";
import { adminAuditRouter } from "./routes/admin/audit";
import { adminJobsRouter } from "./routes/admin/jobs";
import { adminScaffolderMcpTokensRouter } from "./routes/admin/scaffolderMcpTokens";
import { departmentsRouter } from "./routes/departments";
import { scaffolderAccessRequestsRouter } from "./routes/scaffolderAccessRequests";
import { adminScaffolderAccessRequestsRouter } from "./routes/admin/scaffolderAccessRequests";
import { adminScaffolderTemplateAclsRouter } from "./routes/admin/scaffolderTemplateAcls";
import { usersRouter } from "./routes/users";
import {
  agentApprovalsRouter,
  agentsRouter,
  llmRouter,
  secretsRouter,
} from "@feature/agents-backend";
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
import { createScaffolderMcpRouter, createScaffolderRouter } from "@feature/scaffolder-backend";
import { searchRouter } from "@feature/search-backend";
import { requestsRouter } from "@feature/requests-backend";
import {
  maintainerRequestsRouter,
  teamPoliciesRouter,
  teamRequestsRouter,
  teamsRouter,
} from "@feature/teams-backend";
import { vikunjaRouter, configureAuth as configureVikunjaAuth } from "@feature/vikunja-backend";
import { issueCode as oidcIssueCode } from "./oidc";
import { webhooksRouter } from "@feature/webhooks-backend";

export function createServer() {
  const env = loadEnv();
  // Register chat tools into the global agent tool registry once at boot so
  // resolveTools() can find them when streamAgent loads the seeded
  // Platform Assistant.
  registerChatTools();
  configureVikunjaAuth({
    issueCode: async (userId: string) => {
      const { prisma } = await import("@internal/db");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      return oidcIssueCode({
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        githubLogin: user.githubLogin,
        clientId: process.env.VIKUNJA_OIDC_CLIENT_ID ?? "platform-vikunja",
        redirectUri: `${process.env.VIKUNJA_API_URL ?? "http://localhost:3456/api/v1"}/auth/openid/platform`,
      });
    },
  });
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.webOrigin,
      credentials: true,
    }),
  );

  // GitHub webhook needs the raw body for HMAC signature verification, so it
  // must be mounted before express.json() consumes the stream. The router
  // applies its own express.raw() middleware scoped to this path.
  app.use("/integrations/github/webhook", githubWebhookRouter);

  // Same constraint applies to the GitHub App webhook (separate path so the
  // App-wide secret is verified independently of any legacy per-repo webhook
  // configured under the path above).
  app.use("/integrations/github/app-webhook", githubAppWebhookRouter);

  // Grafana Alertmanager webhook: needs the raw body for the Bearer-token
  // header check (the body is parsed AFTER auth) and replay protection,
  // matching the constraint above.
  app.use("/integrations/grafana/webhook", grafanaWebhookRouter);

  app.use(express.json());
  app.use(cookieParser(env.sessionSecret));

  registerHealthRoute(app);

  app.use("/auth", authRouter);
  app.use(oidcRouter);

  // /mcp uses bearer-token auth (ScaffolderMcpToken), not the session cookie,
  // so it sits outside the /api requireAuth chain. The MCP transport handles
  // its own request lifecycle, so apiLimiter is intentionally not applied —
  // a dedicated MCP-aware rate limiter slots in here once we have abuse data.
  app.use(
    "/mcp/scaffolder",
    createScaffolderMcpRouter({ liveRepoRoot: resolve(__dirname, "../../..") }),
  );

  app.use("/api", apiLimiter, requireAuth);

  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/audit", adminAuditRouter);
  app.use("/api/admin/jobs", adminJobsRouter);
  app.use("/api/admin/scaffolder/mcp-tokens", adminScaffolderMcpTokensRouter);
  app.use("/api/admin/scaffolder/access-requests", adminScaffolderAccessRequestsRouter);
  app.use("/api/admin/scaffolder/templates", adminScaffolderTemplateAclsRouter);
  app.use("/api/departments", departmentsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/agent-approvals", agentApprovalsRouter);
  app.use("/api/secrets", secretsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/llm", llmRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/devdocs", devdocsRouter);
  app.use("/api/scorecards", scorecardsRouter);
  app.use("/api/dora-metrics", doraMetricsRouter);
  // Mount the GitHub App install/callback router before the catch-all
  // integrations router so its routes aren't shadowed.
  app.use("/api/integrations/github", githubIntegrationRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/observability", observabilityRouter);
  // Mount the more-specific scaffolder access-requests router before the
  // catch-all `/api/scaffolder` so it isn't shadowed.
  app.use("/api/scaffolder/access-requests", scaffolderAccessRequestsRouter);
  app.use(
    "/api/scaffolder",
    createScaffolderRouter({ liveRepoRoot: resolve(__dirname, "../../..") }),
  );
  app.use("/api/users", usersRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/pages", pagesRouter);
  app.use("/api/search", searchRouter);
  // Mount more-specific team subrouters before the catch-all `/api/teams` so
  // requests to `/api/teams/requests` and `/api/teams/policies` are not
  // matched by the `/:slug` route in teamsRouter.
  app.use("/api/requests", requestsRouter);
  app.use("/api/teams/requests", teamRequestsRouter);
  app.use("/api/teams/maintainer-requests", maintainerRequestsRouter);
  app.use("/api/teams/policies", teamPoliciesRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/vikunja", vikunjaRouter);
  app.use("/api/webhooks", webhooksRouter);

  app.use(errorHandler);

  return app;
}
