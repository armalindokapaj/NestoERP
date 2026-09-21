-- CreateEnum
CREATE TYPE "WorkspaceScope" AS ENUM ('GROUP', 'COMPANY');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "workspaceScope" "WorkspaceScope";

