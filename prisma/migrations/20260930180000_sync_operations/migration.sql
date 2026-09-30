-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "clientOperationId" TEXT;

-- AlterTable
ALTER TABLE "hse_incidents" ADD COLUMN     "clientOperationId" TEXT;

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "serverVersion" INTEGER,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_operations_companyId_createdAt_idx" ON "sync_operations"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_memberId_operationId_key" ON "sync_operations"("memberId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "comments_companyId_authorMemberId_clientOperationId_key" ON "comments"("companyId", "authorMemberId", "clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_incidents_companyId_reportedByMemberId_clientOperationI_key" ON "hse_incidents"("companyId", "reportedByMemberId", "clientOperationId");

