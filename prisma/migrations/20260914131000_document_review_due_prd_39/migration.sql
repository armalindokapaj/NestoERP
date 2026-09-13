-- AlterTable
ALTER TABLE "document_reviews" ADD COLUMN     "dueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "document_reviews_companyId_status_dueAt_idx" ON "document_reviews"("companyId", "status", "dueAt");

