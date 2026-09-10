/*
  Warnings:

  - You are about to drop the column `fileUrl` on the `documents` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "documents" DROP COLUMN "fileUrl",
ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "originalFileName" TEXT,
ADD COLUMN     "preArchiveStatus" "DocumentStatus",
ADD COLUMN     "storageProvider" TEXT,
ADD COLUMN     "uploadedByMemberId" TEXT;

-- CreateIndex
CREATE INDEX "documents_companyId_updatedAt_idx" ON "documents"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "documents_companyId_projectId_status_idx" ON "documents"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "documents_companyId_clientId_status_idx" ON "documents"("companyId", "clientId", "status");

-- CreateIndex
CREATE INDEX "documents_companyId_module_status_idx" ON "documents"("companyId", "module", "status");

-- CreateIndex
CREATE INDEX "documents_uploadedByMemberId_idx" ON "documents"("uploadedByMemberId");

-- CreateIndex
CREATE INDEX "documents_mimeType_idx" ON "documents"("mimeType");

-- CreateIndex
CREATE INDEX "documents_extension_idx" ON "documents"("extension");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByMemberId_fkey" FOREIGN KEY ("uploadedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
