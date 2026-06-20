-- DropForeignKey
ALTER TABLE "CatalogAgentTask" DROP CONSTRAINT "CatalogAgentTask_entityId_fkey";

-- DropTable
DROP TABLE "CatalogAgentTask";

-- DropEnum
DROP TYPE "CatalogAgentTaskStatus";

-- DropEnum
DROP TYPE "CatalogAgentTaskType";
