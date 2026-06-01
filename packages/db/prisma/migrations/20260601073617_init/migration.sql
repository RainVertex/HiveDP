-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('idle', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "CatalogEntityKind" AS ENUM ('service', 'api', 'library', 'website', 'database', 'infrastructure');

-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('experimental', 'production', 'deprecated');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('healthy', 'degraded', 'down');

-- CreateEnum
CREATE TYPE "CatalogEntitySource" AS ENUM ('manual', 'scaffolder', 'discovery', 'agent', 'seed');

-- CreateEnum
CREATE TYPE "CatalogAgentTaskType" AS ENUM ('resolve_ownership', 'generate_yaml', 'open_pr');

-- CreateEnum
CREATE TYPE "CatalogAgentTaskStatus" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "DocSyncStatus" AS ENUM ('ok', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('github', 'jira', 'slack', 'grafana');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "DeptRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "PageSection" AS ENUM ('catalog', 'selfservice', 'requests', 'workspace', 'teams', 'observability', 'admin', 'agents');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('LINK', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "PageScope" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('READ', 'WRITE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScaffoldTaskStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back');

-- CreateEnum
CREATE TYPE "ScaffoldPlanMode" AS ENUM ('create', 'update', 'no_op');

-- CreateEnum
CREATE TYPE "ScaffoldDriftStatus" AS ENUM ('open', 'ignored', 'applied', 'superseded');

-- CreateEnum
CREATE TYPE "AclSubject" AS ENUM ('user', 'team', 'everyone');

-- CreateEnum
CREATE TYPE "TemplateAccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "TemplateAccessPermission" AS ENUM ('view', 'execute');

-- CreateEnum
CREATE TYPE "ScorecardTierStyle" AS ENUM ('stage', 'threshold');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('lead', 'member');

-- CreateEnum
CREATE TYPE "TeamRequestStatus" AS ENUM ('pending', 'awaiting_user_confirmation', 'approved', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "MaintainerRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "TeamPolicyKind" AS ENUM ('name_pattern');

-- CreateEnum
CREATE TYPE "TeamSource" AS ENUM ('manual', 'github');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "UserTaskStatus" AS ENUM ('pending', 'completed', 'dismissed');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('human', 'agent');

-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnvVar" TEXT,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "encryptedValue" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "costPer1kIn" DECIMAL(10,6),
    "costPer1kOut" DECIMAL(10,6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "category" TEXT,
    "kind" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "toolIds" JSONB NOT NULL DEFAULT '[]',
    "approvalMode" TEXT NOT NULL DEFAULT 'ask',
    "maxToolCalls" INTEGER NOT NULL DEFAULT 10,
    "tokenBudget" INTEGER,
    "temperature" DOUBLE PRECISION,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT,
    "trigger" TEXT,
    "taskId" TEXT,
    "conversationId" TEXT,
    "status" "AgentStatus" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DECIMAL(10,6),
    "containsWrites" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "CatalogEntityKind" NOT NULL,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'production',
    "repoUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "CatalogEntitySource" NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "accountLogin" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleSince" TIMESTAMP(3),
    "yamlSpec" JSONB,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "needsOnboarding" BOOLEAN NOT NULL DEFAULT false,
    "unowned" BOOLEAN NOT NULL DEFAULT false,
    "installationId" INTEGER,
    "githubRepoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarredEntity" (
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarredEntity_pkey" PRIMARY KEY ("userId","entityId")
);

-- CreateTable
CREATE TABLE "CatalogEntityOwner" (
    "entityId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogEntityOwner_pkey" PRIMARY KEY ("entityId","teamId")
);

-- CreateTable
CREATE TABLE "CatalogAgentTask" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "CatalogAgentTaskType" NOT NULL,
    "status" "CatalogAgentTaskStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogAgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "agentRunId" TEXT,
    "reasoning" TEXT,
    "reasoningDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatActionPreview" (
    "id" TEXT NOT NULL,
    "shortHandle" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "parsedParams" JSONB NOT NULL,
    "serverSummary" TEXT NOT NULL,
    "policyChecks" JSONB NOT NULL,
    "sideEffects" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "resultRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatActionPreview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "frontmatter" JSONB,
    "sourceRef" TEXT NOT NULL,
    "lastCommitSha" TEXT,
    "lastCommitAt" TIMESTAMP(3),
    "lastCommitBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocComment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocStaleReport" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocStaleReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSyncState" (
    "entityId" TEXT NOT NULL,
    "status" "DocSyncStatus" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedSource" JSONB,

    CONSTRAINT "DocSyncState_pkey" PRIMARY KEY ("entityId")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "IntegrationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubReconciliationRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "teamsCreated" INTEGER NOT NULL DEFAULT 0,
    "teamsUpdated" INTEGER NOT NULL DEFAULT 0,
    "teamsDeleted" INTEGER NOT NULL DEFAULT 0,
    "membersAdded" INTEGER NOT NULL DEFAULT 0,
    "membersRemoved" INTEGER NOT NULL DEFAULT 0,
    "pendingQueued" INTEGER NOT NULL DEFAULT 0,
    "pendingResolved" INTEGER NOT NULL DEFAULT 0,
    "orgMembershipsAdded" INTEGER NOT NULL DEFAULT 0,
    "orgMembershipsRemoved" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "GithubReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "JobRunStatus" NOT NULL DEFAULT 'running',
    "durationMs" INTEGER,
    "error" TEXT,
    "requestId" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobState" (
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cursor" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobState_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventKinds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHealthSample" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL,
    "latencyMs" INTEGER,
    "errorRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoraMetricsSnapshot" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "deployFrequencyPerDay" DOUBLE PRECISION NOT NULL,
    "leadTimeHours" DOUBLE PRECISION NOT NULL,
    "changeFailureRate" DOUBLE PRECISION NOT NULL,
    "mttrHours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoraMetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityObservabilityConfig" (
    "entityId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "upQuery" TEXT,
    "latencyQuery" TEXT,
    "errorQuery" TEXT,
    "logsSelector" TEXT,
    "dashboardUid" TEXT,
    "traceIdRegex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityObservabilityConfig_pkey" PRIMARY KEY ("entityId")
);

-- CreateTable
CREATE TABLE "AlertDeliveryState" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "lastFiringAt" TIMESTAMP(3),
    "lastResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDeliveryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMembership" (
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "DeptRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMembership_pkey" PRIMARY KEY ("departmentId","userId")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "section" "PageSection" NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "url" TEXT,
    "order" DOUBLE PRECISION NOT NULL,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,
    "type" "PageType" NOT NULL DEFAULT 'LINK',
    "scope" "PageScope" NOT NULL DEFAULT 'PERSONAL',
    "layout" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "githubRunId" BIGINT NOT NULL,
    "workflowName" TEXT NOT NULL,
    "workflowPath" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "conclusion" TEXT,
    "headBranch" TEXT,
    "headSha" TEXT NOT NULL,
    "actorLogin" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "runStartedAt" TIMESTAMP(3),
    "runUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "githubDeploymentId" BIGINT NOT NULL,
    "environment" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "actorLogin" TEXT,
    "description" TEXT,
    "htmlUrl" TEXT,
    "logUrl" TEXT,
    "deployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineSyncCursor" (
    "entityId" TEXT NOT NULL,
    "lastWorkflowSyncAt" TIMESTAMP(3),
    "lastDeploymentSyncAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineSyncCursor_pkey" PRIMARY KEY ("entityId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hexColor" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "creatorUserId" TEXT,
    "catalogEntityId" TEXT,
    "installationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'READ',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "Bucket" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taskLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hexColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bucketId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "percentDone" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parentTaskId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "TaskLabel" (
    "taskId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("taskId","labelId")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldPlan" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "mode" "ScaffoldPlanMode" NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'main',
    "capabilities" TEXT[],
    "irreversible" BOOLEAN NOT NULL DEFAULT false,
    "bindingId" TEXT,
    "artifact" JSONB NOT NULL,
    "requiresApproval" JSONB NOT NULL,
    "approvalsGranted" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL DEFAULT 'human',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedTaskId" TEXT,

    CONSTRAINT "ScaffoldPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "ScaffoldTaskStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "compensations" JSONB NOT NULL DEFAULT '[]',
    "triggeredByUserId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL DEFAULT 'human',
    "requestId" TEXT,
    "output" JSONB,

    CONSTRAINT "ScaffoldTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldTaskStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ScaffoldTaskStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "output" JSONB,
    "error" TEXT,

    CONSTRAINT "ScaffoldTaskStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldTaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT,
    "level" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffoldTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldBinding" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "branchName" TEXT,
    "prUrl" TEXT,
    "ownerTeamId" TEXT,
    "catalogEntityId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScaffoldBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateHashSnapshot" (
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateHashSnapshot_pkey" PRIMARY KEY ("templateId")
);

-- CreateTable
CREATE TABLE "TemplateAcl" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "subjectType" "AclSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canExecute" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateAcl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateAccessRequest" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "permission" "TemplateAccessPermission" NOT NULL,
    "reason" TEXT,
    "status" "TemplateAccessRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAclId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffoldDrift" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "toVersion" TEXT NOT NULL,
    "diffSummary" JSONB NOT NULL,
    "status" "ScaffoldDriftStatus" NOT NULL DEFAULT 'open',
    "prUrl" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ScaffoldDrift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaffolderMcpToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffolderMcpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" "CatalogEntityKind"[] DEFAULT ARRAY[]::"CatalogEntityKind"[],
    "tierStyle" "ScorecardTierStyle" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardRule" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "tier" TEXT NOT NULL,

    CONSTRAINT "ScorecardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardResult" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "evidence" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorecardResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "accountLogin" TEXT NOT NULL,
    "source" "TeamSource" NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "externalSlug" TEXT,
    "parentTeamId" TEXT,
    "installationId" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingTeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'member',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingTeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamRequest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "status" "TeamRequestStatus" NOT NULL DEFAULT 'pending',
    "mirrorToGithub" BOOLEAN NOT NULL DEFAULT false,
    "githubIntegrationId" TEXT,
    "roundCount" INTEGER NOT NULL DEFAULT 1,
    "lastEditedByUserId" TEXT,
    "originalSlug" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "originalDescription" TEXT,
    "originalMirrorToGithub" BOOLEAN NOT NULL DEFAULT false,
    "originalGithubIntegrationId" TEXT,
    "proposedMaintainerUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposedMemberUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoCancelReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdTeamId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPolicy" (
    "id" TEXT NOT NULL,
    "kind" "TeamPolicyKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintainerRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "MaintainerRequestStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintainerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "userKind" "UserKind" NOT NULL DEFAULT 'human',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOrgMembership" (
    "userId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOrgMembership_pkey" PRIMARY KEY ("userId","accountLogin")
);

-- CreateTable
CREATE TABLE "UserTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "UserTaskStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UserTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorIp" TEXT,
    "kind" TEXT NOT NULL,
    "targetKind" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmProvider_slug_key" ON "LlmProvider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_providerId_key" ON "ProviderCredential"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "LlmModel_slug_key" ON "LlmModel"("slug");

-- CreateIndex
CREATE INDEX "LlmModel_providerId_idx" ON "LlmModel"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_userId_key" ON "Agent"("userId");

-- CreateIndex
CREATE INDEX "Agent_modelId_idx" ON "Agent"("modelId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_idx" ON "AgentRun"("agentId");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentRun_userId_idx" ON "AgentRun"("userId");

-- CreateIndex
CREATE INDEX "AgentRun_taskId_idx" ON "AgentRun"("taskId");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEntity_githubRepoId_key" ON "CatalogEntity"("githubRepoId");

-- CreateIndex
CREATE INDEX "CatalogEntity_kind_idx" ON "CatalogEntity"("kind");

-- CreateIndex
CREATE INDEX "CatalogEntity_staleSince_idx" ON "CatalogEntity"("staleSince");

-- CreateIndex
CREATE INDEX "CatalogEntity_needsOnboarding_idx" ON "CatalogEntity"("needsOnboarding");

-- CreateIndex
CREATE INDEX "CatalogEntity_unowned_idx" ON "CatalogEntity"("unowned");

-- CreateIndex
CREATE INDEX "CatalogEntity_installationId_idx" ON "CatalogEntity"("installationId");

-- CreateIndex
CREATE INDEX "CatalogEntity_accountLogin_idx" ON "CatalogEntity"("accountLogin");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEntity_name_kind_key" ON "CatalogEntity"("name", "kind");

-- CreateIndex
CREATE INDEX "StarredEntity_entityId_idx" ON "StarredEntity"("entityId");

-- CreateIndex
CREATE INDEX "CatalogEntityOwner_teamId_idx" ON "CatalogEntityOwner"("teamId");

-- CreateIndex
CREATE INDEX "CatalogAgentTask_status_scheduledAt_idx" ON "CatalogAgentTask"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CatalogAgentTask_entityId_idx" ON "CatalogAgentTask"("entityId");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_updatedAt_idx" ON "ChatConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatConversation_agentId_idx" ON "ChatConversation"("agentId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatActionPreview_conversationId_toolId_supersededAt_consum_idx" ON "ChatActionPreview"("conversationId", "toolId", "supersededAt", "consumedAt");

-- CreateIndex
CREATE INDEX "ChatActionPreview_userId_idx" ON "ChatActionPreview"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatActionPreview_conversationId_shortHandle_key" ON "ChatActionPreview"("conversationId", "shortHandle");

-- CreateIndex
CREATE INDEX "DocPage_entityId_idx" ON "DocPage"("entityId");

-- CreateIndex
CREATE INDEX "DocPage_lastCommitAt_idx" ON "DocPage"("lastCommitAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocPage_entityId_slug_key" ON "DocPage"("entityId", "slug");

-- CreateIndex
CREATE INDEX "DocComment_pageId_createdAt_idx" ON "DocComment"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "DocComment_authorId_idx" ON "DocComment"("authorId");

-- CreateIndex
CREATE INDEX "DocStaleReport_pageId_idx" ON "DocStaleReport"("pageId");

-- CreateIndex
CREATE INDEX "DocStaleReport_resolvedAt_idx" ON "DocStaleReport"("resolvedAt");

-- CreateIndex
CREATE INDEX "Integration_kind_idx" ON "Integration"("kind");

-- CreateIndex
CREATE INDEX "GithubReconciliationRun_installationId_startedAt_idx" ON "GithubReconciliationRun"("installationId", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_ownerUserId_idx" ON "WebhookSubscription"("ownerUserId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_ownerTeamId_idx" ON "WebhookSubscription"("ownerTeamId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_idx" ON "WebhookDelivery"("subscriptionId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ServiceHealthSample_entityId_idx" ON "ServiceHealthSample"("entityId");

-- CreateIndex
CREATE INDEX "ServiceHealthSample_createdAt_idx" ON "ServiceHealthSample"("createdAt");

-- CreateIndex
CREATE INDEX "DoraMetricsSnapshot_entityId_idx" ON "DoraMetricsSnapshot"("entityId");

-- CreateIndex
CREATE INDEX "DoraMetricsSnapshot_periodEnd_idx" ON "DoraMetricsSnapshot"("periodEnd");

-- CreateIndex
CREATE INDEX "EntityObservabilityConfig_integrationId_idx" ON "EntityObservabilityConfig"("integrationId");

-- CreateIndex
CREATE INDEX "AlertDeliveryState_integrationId_idx" ON "AlertDeliveryState"("integrationId");

-- CreateIndex
CREATE INDEX "AlertDeliveryState_lastResolvedAt_idx" ON "AlertDeliveryState"("lastResolvedAt");

-- CreateIndex
CREATE INDEX "AlertDeliveryState_lastFiringAt_idx" ON "AlertDeliveryState"("lastFiringAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDeliveryState_integrationId_fingerprint_key" ON "AlertDeliveryState"("integrationId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Department_slug_key" ON "Department"("slug");

-- CreateIndex
CREATE INDEX "DepartmentMembership_userId_idx" ON "DepartmentMembership"("userId");

-- CreateIndex
CREATE INDEX "Page_ownerUserId_section_parentId_order_idx" ON "Page"("ownerUserId", "section", "parentId", "order");

-- CreateIndex
CREATE INDEX "Page_ownerUserId_section_deletedAt_idx" ON "Page"("ownerUserId", "section", "deletedAt");

-- CreateIndex
CREATE INDEX "Page_scope_section_parentId_order_idx" ON "Page"("scope", "section", "parentId", "order");

-- CreateIndex
CREATE INDEX "Page_parentId_idx" ON "Page"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_githubRunId_key" ON "WorkflowRun"("githubRunId");

-- CreateIndex
CREATE INDEX "WorkflowRun_entityId_runUpdatedAt_idx" ON "WorkflowRun"("entityId", "runUpdatedAt" DESC);

-- CreateIndex
CREATE INDEX "WorkflowRun_entityId_headBranch_idx" ON "WorkflowRun"("entityId", "headBranch");

-- CreateIndex
CREATE INDEX "WorkflowRun_entityId_conclusion_idx" ON "WorkflowRun"("entityId", "conclusion");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_githubDeploymentId_key" ON "Deployment"("githubDeploymentId");

-- CreateIndex
CREATE INDEX "Deployment_entityId_environment_deployedAt_idx" ON "Deployment"("entityId", "environment", "deployedAt" DESC);

-- CreateIndex
CREATE INDEX "Deployment_entityId_state_idx" ON "Deployment"("entityId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Project_catalogEntityId_key" ON "Project"("catalogEntityId");

-- CreateIndex
CREATE INDEX "Project_creatorUserId_idx" ON "Project"("creatorUserId");

-- CreateIndex
CREATE INDEX "Project_installationId_idx" ON "Project"("installationId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_role_idx" ON "ProjectMember"("userId", "role");

-- CreateIndex
CREATE INDEX "Bucket_projectId_position_idx" ON "Bucket"("projectId", "position");

-- CreateIndex
CREATE INDEX "Label_projectId_idx" ON "Label"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_projectId_title_key" ON "Label"("projectId", "title");

-- CreateIndex
CREATE INDEX "Task_projectId_done_idx" ON "Task"("projectId", "done");

-- CreateIndex
CREATE INDEX "Task_projectId_bucketId_position_idx" ON "Task"("projectId", "bucketId", "position");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE INDEX "TaskLabel_labelId_idx" ON "TaskLabel"("labelId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScaffoldPlan_appliedTaskId_key" ON "ScaffoldPlan"("appliedTaskId");

-- CreateIndex
CREATE INDEX "ScaffoldPlan_templateId_createdAt_idx" ON "ScaffoldPlan"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "ScaffoldPlan_createdByUserId_idx" ON "ScaffoldPlan"("createdByUserId");

-- CreateIndex
CREATE INDEX "ScaffoldPlan_bindingId_idx" ON "ScaffoldPlan"("bindingId");

-- CreateIndex
CREATE UNIQUE INDEX "ScaffoldTask_planId_key" ON "ScaffoldTask"("planId");

-- CreateIndex
CREATE INDEX "ScaffoldTask_status_idx" ON "ScaffoldTask"("status");

-- CreateIndex
CREATE INDEX "ScaffoldTask_triggeredByUserId_idx" ON "ScaffoldTask"("triggeredByUserId");

-- CreateIndex
CREATE INDEX "ScaffoldTaskStep_taskId_idx" ON "ScaffoldTaskStep"("taskId");

-- CreateIndex
CREATE INDEX "ScaffoldTaskLog_taskId_createdAt_idx" ON "ScaffoldTaskLog"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ScaffoldBinding_templateId_idx" ON "ScaffoldBinding"("templateId");

-- CreateIndex
CREATE INDEX "ScaffoldBinding_ownerTeamId_idx" ON "ScaffoldBinding"("ownerTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScaffoldBinding_templateId_targetRef_key" ON "ScaffoldBinding"("templateId", "targetRef");

-- CreateIndex
CREATE INDEX "TemplateAcl_templateId_idx" ON "TemplateAcl"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateAcl_templateId_subjectType_subjectId_key" ON "TemplateAcl"("templateId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "TemplateAccessRequest_templateId_status_idx" ON "TemplateAccessRequest"("templateId", "status");

-- CreateIndex
CREATE INDEX "TemplateAccessRequest_requestedByUserId_idx" ON "TemplateAccessRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "TemplateAccessRequest_status_createdAt_idx" ON "TemplateAccessRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScaffoldDrift_bindingId_idx" ON "ScaffoldDrift"("bindingId");

-- CreateIndex
CREATE INDEX "ScaffoldDrift_status_idx" ON "ScaffoldDrift"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScaffolderMcpToken_tokenHash_key" ON "ScaffolderMcpToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScaffolderMcpToken_userId_idx" ON "ScaffolderMcpToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_slug_key" ON "Scorecard"("slug");

-- CreateIndex
CREATE INDEX "ScorecardRule_scorecardId_idx" ON "ScorecardRule"("scorecardId");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardRule_scorecardId_key_key" ON "ScorecardRule"("scorecardId", "key");

-- CreateIndex
CREATE INDEX "ScorecardResult_scorecardId_entityId_idx" ON "ScorecardResult"("scorecardId", "entityId");

-- CreateIndex
CREATE INDEX "ScorecardResult_entityId_idx" ON "ScorecardResult"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardResult_entityId_ruleId_key" ON "ScorecardResult"("entityId", "ruleId");

-- CreateIndex
CREATE INDEX "Team_installationId_idx" ON "Team"("installationId");

-- CreateIndex
CREATE INDEX "Team_source_idx" ON "Team"("source");

-- CreateIndex
CREATE INDEX "Team_accountLogin_idx" ON "Team"("accountLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Team_source_externalId_key" ON "Team"("source", "externalId");

-- CreateIndex
CREATE INDEX "PendingTeamMembership_githubId_expiresAt_idx" ON "PendingTeamMembership"("githubId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingTeamMembership_teamId_githubId_key" ON "PendingTeamMembership"("teamId", "githubId");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE INDEX "TeamRequest_requestedByUserId_idx" ON "TeamRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "TeamRequest_status_expiresAt_idx" ON "TeamRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TeamRequest_createdTeamId_idx" ON "TeamRequest"("createdTeamId");

-- CreateIndex
CREATE INDEX "TeamRequest_githubIntegrationId_idx" ON "TeamRequest"("githubIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPolicy_kind_key" ON "TeamPolicy"("kind");

-- CreateIndex
CREATE INDEX "MaintainerRequest_teamId_status_idx" ON "MaintainerRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "MaintainerRequest_requestedByUserId_idx" ON "MaintainerRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "MaintainerRequest_status_expiresAt_idx" ON "MaintainerRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubLogin_key" ON "User"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_userKind_idx" ON "User"("userKind");

-- CreateIndex
CREATE INDEX "UserOrgMembership_accountLogin_idx" ON "UserOrgMembership"("accountLogin");

-- CreateIndex
CREATE INDEX "UserTask_userId_status_idx" ON "UserTask"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserTask_userId_kind_key" ON "UserTask"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_kind_idx" ON "AuditEvent"("kind");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetKind_targetId_idx" ON "AuditEvent"("targetKind", "targetId");

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmModel" ADD CONSTRAINT "LlmModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "LlmModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarredEntity" ADD CONSTRAINT "StarredEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarredEntity" ADD CONSTRAINT "StarredEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogEntityOwner" ADD CONSTRAINT "CatalogEntityOwner_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogEntityOwner" ADD CONSTRAINT "CatalogEntityOwner_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogAgentTask" ADD CONSTRAINT "CatalogAgentTask_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatActionPreview" ADD CONSTRAINT "ChatActionPreview_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocComment" ADD CONSTRAINT "DocComment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocComment" ADD CONSTRAINT "DocComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocStaleReport" ADD CONSTRAINT "DocStaleReport_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocStaleReport" ADD CONSTRAINT "DocStaleReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSyncState" ADD CONSTRAINT "DocSyncState_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHealthSample" ADD CONSTRAINT "ServiceHealthSample_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoraMetricsSnapshot" ADD CONSTRAINT "DoraMetricsSnapshot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityObservabilityConfig" ADD CONSTRAINT "EntityObservabilityConfig_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityObservabilityConfig" ADD CONSTRAINT "EntityObservabilityConfig_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDeliveryState" ADD CONSTRAINT "AlertDeliveryState_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineSyncCursor" ADD CONSTRAINT "PipelineSyncCursor_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_catalogEntityId_fkey" FOREIGN KEY ("catalogEntityId") REFERENCES "CatalogEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldPlan" ADD CONSTRAINT "ScaffoldPlan_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ScaffoldBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldPlan" ADD CONSTRAINT "ScaffoldPlan_appliedTaskId_fkey" FOREIGN KEY ("appliedTaskId") REFERENCES "ScaffoldTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldPlan" ADD CONSTRAINT "ScaffoldPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldTask" ADD CONSTRAINT "ScaffoldTask_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldTaskStep" ADD CONSTRAINT "ScaffoldTaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScaffoldTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldTaskLog" ADD CONSTRAINT "ScaffoldTaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScaffoldTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldBinding" ADD CONSTRAINT "ScaffoldBinding_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAccessRequest" ADD CONSTRAINT "TemplateAccessRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAccessRequest" ADD CONSTRAINT "TemplateAccessRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffoldDrift" ADD CONSTRAINT "ScaffoldDrift_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ScaffoldBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScaffolderMcpToken" ADD CONSTRAINT "ScaffolderMcpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardRule" ADD CONSTRAINT "ScorecardRule_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardResult" ADD CONSTRAINT "ScorecardResult_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardResult" ADD CONSTRAINT "ScorecardResult_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ScorecardRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardResult" ADD CONSTRAINT "ScorecardResult_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "CatalogEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_parentTeamId_fkey" FOREIGN KEY ("parentTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTeamMembership" ADD CONSTRAINT "PendingTeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_createdTeamId_fkey" FOREIGN KEY ("createdTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_githubIntegrationId_fkey" FOREIGN KEY ("githubIntegrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintainerRequest" ADD CONSTRAINT "MaintainerRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintainerRequest" ADD CONSTRAINT "MaintainerRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintainerRequest" ADD CONSTRAINT "MaintainerRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgMembership" ADD CONSTRAINT "UserOrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
