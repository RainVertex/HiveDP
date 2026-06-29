-- Cross-process cancel signal: the API Stop endpoint sets this, the worker executing the run polls it.
ALTER TABLE "AgentRun" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);

-- Denormalized fairness bucket so the fair claimer can group running tasks by owner.
ALTER TABLE "AgentTask" ADD COLUMN "ownerKey" TEXT;

-- Backfill existing rows from the agent's backing user, falling back to a per-agent bucket.
UPDATE "AgentTask" t
SET "ownerKey" = COALESCE(a."userId", 'agent:' || t."agentId")
FROM "Agent" a
WHERE a."id" = t."agentId";

-- Replace the FIFO claim index with one keyed on the fairness bucket.
DROP INDEX "AgentTask_status_scheduledAt_idx";
CREATE INDEX "AgentTask_status_ownerKey_scheduledAt_idx" ON "AgentTask"("status", "ownerKey", "scheduledAt");
