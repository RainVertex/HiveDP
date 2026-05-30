/*
  Warnings:

  - You are about to drop the column `costBudgetMonthly` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `costBudgetUsed` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `modelProvider` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `onBehalfOfRequired` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `ownerUserId` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `owningTeamId` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `secretId` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `tokenBudgetMonthly` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `tokenBudgetUsed` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `toolApprovalPolicy` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the `AgentApprovalRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Secret` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_ownerUserId_fkey";

-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_owningTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_secretId_fkey";

-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_userId_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_agentUserId_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_decidedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Secret" DROP CONSTRAINT "Secret_ownerTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Secret" DROP CONSTRAINT "Secret_ownerUserId_fkey";

-- DropIndex
DROP INDEX "Agent_ownerUserId_idx";

-- DropIndex
DROP INDEX "Agent_owningTeamId_idx";

-- DropIndex
DROP INDEX "Agent_userId_key";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "costBudgetMonthly",
DROP COLUMN "costBudgetUsed",
DROP COLUMN "modelProvider",
DROP COLUMN "onBehalfOfRequired",
DROP COLUMN "ownerUserId",
DROP COLUMN "owningTeamId",
DROP COLUMN "secretId",
DROP COLUMN "tokenBudgetMonthly",
DROP COLUMN "tokenBudgetUsed",
DROP COLUMN "toolApprovalPolicy",
DROP COLUMN "userId",
ADD COLUMN     "approvalMode" TEXT NOT NULL DEFAULT 'ask';

-- DropTable
DROP TABLE "AgentApprovalRequest";

-- DropTable
DROP TABLE "Secret";

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
