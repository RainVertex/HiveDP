-- CreateEnum
CREATE TYPE "AgentApprovalMode" AS ENUM ('ask', 'auto');

-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('schedule', 'manual', 'startup');

-- AlterTable: convert Agent.approvalMode String -> enum, preserving existing values
ALTER TABLE "Agent" ALTER COLUMN "approvalMode" DROP DEFAULT;
ALTER TABLE "Agent" ALTER COLUMN "approvalMode" TYPE "AgentApprovalMode" USING ("approvalMode"::text::"AgentApprovalMode");
ALTER TABLE "Agent" ALTER COLUMN "approvalMode" SET DEFAULT 'ask';

-- AlterTable: convert JobRun.triggeredBy String -> enum, preserving existing values
ALTER TABLE "JobRun" ALTER COLUMN "triggeredBy" TYPE "JobTrigger" USING ("triggeredBy"::text::"JobTrigger");

-- AlterTable: add @updatedAt columns. Backfill existing rows with now() via a
-- temporary default, then drop it so the column matches Prisma's app-managed
-- @updatedAt (no database default, Prisma sets it on every write).
ALTER TABLE "Department" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Department" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "DocStaleReport" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DocStaleReport" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Notification" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Notification" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ScaffoldDrift" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ScaffoldDrift" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ScaffolderMcpToken" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ScaffolderMcpToken" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "TemplateAcl" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TemplateAcl" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "WebhookDelivery" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WebhookDelivery" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "DocStaleReport_reporterId_idx" ON "DocStaleReport"("reporterId");

-- CreateIndex
CREATE INDEX "JobRun_triggeredByUserId_idx" ON "JobRun"("triggeredByUserId");

-- CreateIndex
CREATE INDEX "ProjectMember_addedByUserId_idx" ON "ProjectMember"("addedByUserId");

-- CreateIndex
CREATE INDEX "ScaffoldBinding_catalogEntityId_idx" ON "ScaffoldBinding"("catalogEntityId");

-- CreateIndex
CREATE INDEX "ScaffoldBinding_appliedByUserId_idx" ON "ScaffoldBinding"("appliedByUserId");

-- CreateIndex
CREATE INDEX "ScorecardResult_ruleId_idx" ON "ScorecardResult"("ruleId");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "Task_createdByUserId_idx" ON "Task"("createdByUserId");

-- CreateIndex
CREATE INDEX "TaskAssignee_assignedByUserId_idx" ON "TaskAssignee"("assignedByUserId");

-- CreateIndex
CREATE INDEX "TaskComment_authorUserId_idx" ON "TaskComment"("authorUserId");

-- CreateIndex
CREATE INDEX "Team_departmentId_idx" ON "Team"("departmentId");

-- CreateIndex
CREATE INDEX "Team_parentTeamId_idx" ON "Team"("parentTeamId");

-- CreateIndex
CREATE INDEX "TemplateAccessRequest_reviewedByUserId_idx" ON "TemplateAccessRequest"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "TemplateAcl_subjectType_subjectId_idx" ON "TemplateAcl"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
