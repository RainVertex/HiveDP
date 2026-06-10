-- Self-service scaffolder no longer writes into the live platform repo, every apply runs in an isolated worktree.
ALTER TABLE "ScaffoldPlan" ALTER COLUMN "target" SET DEFAULT 'worktree';

UPDATE "ScaffoldPlan" SET "target" = 'worktree' WHERE "target" IN ('main', 'branch');
UPDATE "ScaffoldBinding" SET "target" = 'worktree' WHERE "target" IN ('main', 'branch');
