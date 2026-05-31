-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "trigger" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "taskId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_taskId_idx" ON "AgentRun"("taskId");
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
