/*
  Warnings:

  - You are about to drop the column `searchVector` on the `DocPage` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "CatalogEntity_name_trgm_idx";

-- DropIndex
DROP INDEX "DocPage_searchVector_idx";

-- DropIndex
DROP INDEX "Page_title_trgm_idx";

-- DropIndex
DROP INDEX "Project_title_trgm_idx";

-- DropIndex
DROP INDEX "Task_title_trgm_idx";

-- DropIndex
DROP INDEX "Team_name_trgm_idx";

-- AlterTable
ALTER TABLE "DocPage" DROP COLUMN "searchVector";
