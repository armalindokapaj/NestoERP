-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "module" TEXT,
ADD COLUMN     "preArchiveStatus" "TaskStatus",
ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_companyId_updatedAt_idx" ON "tasks"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "tasks_companyId_dueDate_idx" ON "tasks"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_companyId_assigneeMemberId_status_idx" ON "tasks"("companyId", "assigneeMemberId", "status");

-- CreateIndex
CREATE INDEX "tasks_companyId_projectId_status_idx" ON "tasks"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_createdByMemberId_idx" ON "tasks"("createdByMemberId");

-- CreateIndex
CREATE INDEX "tasks_module_idx" ON "tasks"("module");

-- CreateIndex
CREATE INDEX "tasks_entityType_entityId_idx" ON "tasks"("entityType", "entityId");
