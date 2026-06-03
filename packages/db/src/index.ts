import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Check your .env file.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

// Compile-time scoped views over the shared client: platform-core reads are allowed everywhere, feature-private models stay hidden behind each facade. Zero runtime cost (all alias the same singleton).
type Ops =
  | "$transaction"
  | "$queryRaw"
  | "$queryRawUnsafe"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "$connect"
  | "$disconnect";

type CoreModel =
  | "user"
  | "userOrgMembership"
  | "userTask"
  | "session"
  | "auditEvent"
  | "catalogEntity"
  | "starredEntity"
  | "catalogEntityOwner"
  | "catalogEntityTeamGrant"
  | "catalogAgentTask"
  | "team"
  | "teamMembership"
  | "pendingTeamMembership"
  | "department"
  | "departmentMembership"
  | "integration"
  | "githubReconciliationRun"
  | "systemSetting"
  | "chatConversation";

export const coreDb = prisma as Pick<PrismaClient, CoreModel | Ops>;

export const projectsDb = prisma as Pick<
  PrismaClient,
  | CoreModel
  | "project"
  | "projectMember"
  | "bucket"
  | "label"
  | "task"
  | "taskAssignee"
  | "taskLabel"
  | "taskComment"
  | "agentRun"
  | Ops
>;

export const scaffolderDb = prisma as Pick<
  PrismaClient,
  | CoreModel
  | "scaffoldPlan"
  | "scaffoldTask"
  | "scaffoldTaskStep"
  | "scaffoldTaskLog"
  | "scaffoldBinding"
  | "templateHashSnapshot"
  | "templateAcl"
  | "templateAccessRequest"
  | "scaffoldDrift"
  | "scaffolderMcpToken"
  | Ops
>;

export const chatDb = prisma as Pick<
  PrismaClient,
  CoreModel | "chatMessage" | "chatActionPreview" | "agent" | "agentRun" | Ops
>;

export const agentDb = prisma as Pick<
  PrismaClient,
  CoreModel | "agent" | "agentRun" | "llmProvider" | "llmModel" | "providerCredential" | Ops
>;

export const docsDb = prisma as Pick<
  PrismaClient,
  CoreModel | "docPage" | "docComment" | "docStaleReport" | "docSyncState" | Ops
>;

export const pipelinesDb = prisma as Pick<
  PrismaClient,
  CoreModel | "workflowRun" | "deployment" | "pipelineSyncCursor" | Ops
>;

export const observabilityDb = prisma as Pick<
  PrismaClient,
  | CoreModel
  | "serviceHealthSample"
  | "doraMetricsSnapshot"
  | "entityObservabilityConfig"
  | "alertDeliveryState"
  | Ops
>;

export const scorecardDb = prisma as Pick<
  PrismaClient,
  CoreModel | "scorecard" | "scorecardRule" | "scorecardResult" | Ops
>;

export const notificationsDb = prisma as Pick<
  PrismaClient,
  CoreModel | "notification" | "webhookSubscription" | "webhookDelivery" | Ops
>;

export const teamsDb = prisma as Pick<
  PrismaClient,
  CoreModel | "teamRequest" | "maintainerRequest" | "teamPolicy" | Ops
>;

export const pagesDb = prisma as Pick<PrismaClient, CoreModel | "page" | Ops>;

export * from "@prisma/client";
export { encryptSecret, decryptSecret } from "./secrets";
export { ensureAgentBackingUser, type AgentIdentity } from "./agentUser";
export {
  parsePageParams,
  buildPageResult,
  type ParsedPageParams,
  type PageResult,
} from "./pagination";
