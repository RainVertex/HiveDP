-- Remove the team-creation-request, maintainer-request, and team-policy data model.
-- Dropping each table also removes its own foreign keys and indexes.

-- DropTable
DROP TABLE "MaintainerRequest";

-- DropTable
DROP TABLE "TeamPolicy";

-- DropTable
DROP TABLE "TeamRequest";

-- DropEnum
DROP TYPE "MaintainerRequestStatus";

-- DropEnum
DROP TYPE "TeamPolicyKind";

-- DropEnum
DROP TYPE "TeamRequestStatus";
