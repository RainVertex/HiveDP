-- Approval removed from the scaffolder: plans are no longer gated by capability approvals.
ALTER TABLE "ScaffoldPlan" DROP COLUMN "requiresApproval",
DROP COLUMN "approvalsGranted";
