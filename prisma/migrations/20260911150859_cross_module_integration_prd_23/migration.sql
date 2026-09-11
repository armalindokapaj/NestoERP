-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('REFERENCE', 'CREATE_FROM', 'SYNCHRONIZE');

-- CreateEnum
CREATE TYPE "IntegrationLinkStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "integration_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "mode" "IntegrationMode" NOT NULL DEFAULT 'CREATE_FROM',
    "sourceModule" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetModule" TEXT NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "status" "IntegrationLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_attempts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "IntegrationAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "errorCode" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_links_companyId_idx" ON "integration_links"("companyId");

-- CreateIndex
CREATE INDEX "integration_links_sourceModule_sourceEntityType_sourceEntit_idx" ON "integration_links"("sourceModule", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "integration_links_targetModule_targetEntityType_targetEntit_idx" ON "integration_links"("targetModule", "targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "integration_links_status_idx" ON "integration_links"("status");

-- CreateIndex
CREATE INDEX "integration_links_correlationId_idx" ON "integration_links"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_links_companyId_integrationType_idempotencyKey_key" ON "integration_links"("companyId", "integrationType", "idempotencyKey");

-- CreateIndex
CREATE INDEX "integration_attempts_companyId_idx" ON "integration_attempts"("companyId");

-- CreateIndex
CREATE INDEX "integration_attempts_integrationType_idx" ON "integration_attempts"("integrationType");

-- CreateIndex
CREATE INDEX "integration_attempts_sourceModule_sourceEntityType_sourceEn_idx" ON "integration_attempts"("sourceModule", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "integration_attempts_idempotencyKey_idx" ON "integration_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "integration_attempts_correlationId_idx" ON "integration_attempts"("correlationId");

-- CreateIndex
CREATE INDEX "integration_attempts_status_idx" ON "integration_attempts"("status");

-- AddForeignKey
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_attempts" ADD CONSTRAINT "integration_attempts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
