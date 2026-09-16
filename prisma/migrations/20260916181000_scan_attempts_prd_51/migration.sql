-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "scanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "scanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanStartedAt" TIMESTAMP(3);

