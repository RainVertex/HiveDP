// Workspace backend — Plane integration mirror.
// See features/workspace/backend/src/routes.ts for HTTP handlers and
// src/sync/* for the mirror sync layer. The webhook router is exported
// separately because it needs to be mounted with express.raw() before
// express.json() (the GitHub webhook follows the same pattern).

import { Router } from "express";
import { workspaceRoutes } from "./routes";

export const workspaceRouter: Router = Router();
workspaceRouter.use(workspaceRoutes);

export { planeWebhookRouter } from "./sync/webhookReceiver";
export { fullSync, incrementalSync, clientForIntegration, workspaceSlugOf } from "./sync/engine";
export { upsertWorkItem } from "./sync/upsert";
