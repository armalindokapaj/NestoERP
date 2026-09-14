-- PRD #41 Unified Approvals Center: chain steps, delegations, decision receipts, and
-- Procurement's purchase-order approval policy. Additive only.

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED');






-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerKey" VARCHAR(40) NOT NULL,
    "approvalId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "approverMemberId" TEXT,
    "approverRoleKey" VARCHAR(40),
    "approverPermission" VARCHAR(80),
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByMemberId" TEXT,
    "onBehalfOfMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "providerKey" VARCHAR(40),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMemberId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decision_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "providerKey" VARCHAR(40) NOT NULL,
    "approvalId" TEXT NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decision_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_approval_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financeStepAbove" DECIMAL(18,2),
    "executiveStepAbove" DECIMAL(18,2),
    "executiveRoleKey" VARCHAR(40) NOT NULL DEFAULT 'CEO',
    "currency" VARCHAR(3) NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_steps_companyId_approvalId_stepNumber_idx" ON "approval_steps"("companyId", "approvalId", "stepNumber");

-- CreateIndex
CREATE INDEX "approval_steps_companyId_approverMemberId_status_idx" ON "approval_steps"("companyId", "approverMemberId", "status");

-- CreateIndex
CREATE INDEX "approval_steps_companyId_decidedByMemberId_status_idx" ON "approval_steps"("companyId", "decidedByMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_providerKey_approvalId_stepNumber_key" ON "approval_steps"("providerKey", "approvalId", "stepNumber");

-- CreateIndex
CREATE INDEX "approval_delegations_companyId_fromMemberId_startsAt_endsAt_idx" ON "approval_delegations"("companyId", "fromMemberId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "approval_delegations_companyId_toMemberId_startsAt_endsAt_idx" ON "approval_delegations"("companyId", "toMemberId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "approval_decision_receipts_createdAt_idx" ON "approval_decision_receipts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decision_receipts_companyId_memberId_idempotencyKe_key" ON "approval_decision_receipts"("companyId", "memberId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_approval_policies_companyId_key" ON "procurement_approval_policies"("companyId");

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision_receipts" ADD CONSTRAINT "approval_decision_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_approval_policies" ADD CONSTRAINT "procurement_approval_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

