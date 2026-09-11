-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTHENTICATION', 'ACCESS_CONTROL', 'CONFIGURATION', 'FINANCIAL', 'LEGAL', 'PROCUREMENT', 'INVENTORY', 'QUALITY', 'HSE', 'HR', 'SALES', 'PROJECT', 'DOCUMENT', 'REPORTING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'IMPORTANT', 'CRITICAL');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorMemberId" TEXT,
    "actorDisplayNameSnapshot" TEXT,
    "actorRoleSnapshot" TEXT,
    "moduleKey" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "actionKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabelSnapshot" TEXT,
    "projectId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "changesJson" JSONB,
    "reason" TEXT,
    "metadataJson" JSONB,
    "correlationId" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_companyId_occurredAt_id_idx" ON "audit_events"("companyId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "audit_events_companyId_actionKey_occurredAt_idx" ON "audit_events"("companyId", "actionKey", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_companyId_moduleKey_occurredAt_idx" ON "audit_events"("companyId", "moduleKey", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_companyId_category_occurredAt_idx" ON "audit_events"("companyId", "category", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_companyId_severity_occurredAt_idx" ON "audit_events"("companyId", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_actorMemberId_occurredAt_idx" ON "audit_events"("actorMemberId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_projectId_occurredAt_idx" ON "audit_events"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_correlationId_idx" ON "audit_events"("correlationId");

-- CreateIndex
CREATE INDEX "audit_events_requestId_idx" ON "audit_events"("requestId");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
