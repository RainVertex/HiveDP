/*
  Warnings:

  - The values [guest] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `GuestGrant` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('admin', 'member');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'member';
COMMIT;

-- DropForeignKey
ALTER TABLE "GuestGrant" DROP CONSTRAINT "GuestGrant_grantedById_fkey";

-- DropForeignKey
ALTER TABLE "GuestGrant" DROP CONSTRAINT "GuestGrant_granteeId_fkey";

-- DropTable
DROP TABLE "GuestGrant";

-- DropEnum
DROP TYPE "GrantTarget";
