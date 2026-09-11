-- Sales module (PRD #17).
--
-- The V0.1 `opportunities` table was a module test record from PRD #8: a name,
-- one amount, an optional owner and a stage that began at LEAD. The real
-- opportunity has a required owner, a separate Lead entity in front of it, a
-- stage ladder with DISCOVERY in it, a probability, a conversion trail to the
-- canonical Client and Project, and Proposals hanging off it.
--
-- There is no honest conversion between the two. `value` cannot be split into
-- an estimate plus a probability, `LEAD` is now a record type rather than a
-- stage, and `createdBy` held a user id where the new column holds a
-- membership. So the demo rows are removed and the seed rebuilds them in the
-- new shape, rather than inventing an owner per row and pretending it was
-- always there.
DELETE FROM "activities" WHERE "entityType" = 'Opportunity';
DELETE FROM "opportunities";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'REFERRAL', 'OUTBOUND', 'EVENT', 'PARTNER', 'SOCIAL', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_RESPONSE', 'SCOPE_MISMATCH', 'INTERNAL_DECISION', 'OTHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SalesApprovalRecordType" AS ENUM ('PROPOSAL');

-- CreateEnum
CREATE TYPE "SalesApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "OpportunityStage_new" AS ENUM ('PROSPECTING', 'QUALIFIED', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
ALTER TABLE "public"."opportunities" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "opportunities" ALTER COLUMN "stage" TYPE "OpportunityStage_new" USING ("stage"::text::"OpportunityStage_new");
-- `preArchiveStage` is added below, already typed with the new enum: the
-- generated diff assumed it existed before the swap.
ALTER TYPE "OpportunityStage" RENAME TO "OpportunityStage_old";
ALTER TYPE "OpportunityStage_new" RENAME TO "OpportunityStage";
DROP TYPE "public"."OpportunityStage_old";
ALTER TABLE "opportunities" ALTER COLUMN "stage" SET DEFAULT 'PROSPECTING';
COMMIT;

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_ownerMemberId_fkey";

-- AlterTable
ALTER TABLE "opportunities" DROP COLUMN "archivedBy",
DROP COLUMN "createdBy",
DROP COLUMN "expectedClose",
DROP COLUMN "notes",
DROP COLUMN "updatedBy",
DROP COLUMN "value",
ADD COLUMN     "actualCloseDate" TIMESTAMP(3),
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "convertedProjectId" TEXT,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimatedValue" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "expectedCloseDate" TIMESTAMP(3),
ADD COLUMN     "lostNote" TEXT,
ADD COLUMN     "lostReason" "LostReason",
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "preArchiveStage" "OpportunityStage",
ADD COLUMN     "probabilityOverride" DECIMAL(5,2),
ADD COLUMN     "sourceLeadId" TEXT,
ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedByMemberId" TEXT,
ADD COLUMN     "wonReason" TEXT,
ALTER COLUMN "ownerMemberId" SET NOT NULL,
ALTER COLUMN "stage" SET DEFAULT 'PROSPECTING',
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "preArchiveStatus" "LeadStatus",
    "ownerMemberId" TEXT,
    "notes" TEXT,
    "estimatedValue" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "disqualifyReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedClientId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "proposalNumber" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "preArchiveStatus" "ProposalStatus",
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_line_items" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "SalesApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "SalesApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_companyId_idx" ON "leads"("companyId");

-- CreateIndex
CREATE INDEX "leads_companyId_status_idx" ON "leads"("companyId", "status");

-- CreateIndex
CREATE INDEX "leads_companyId_ownerMemberId_idx" ON "leads"("companyId", "ownerMemberId");

-- CreateIndex
CREATE INDEX "leads_companyId_source_idx" ON "leads"("companyId", "source");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");

-- CreateIndex
CREATE INDEX "leads_updatedAt_idx" ON "leads"("updatedAt");

-- CreateIndex
CREATE INDEX "proposals_companyId_idx" ON "proposals"("companyId");

-- CreateIndex
CREATE INDEX "proposals_companyId_status_idx" ON "proposals"("companyId", "status");

-- CreateIndex
CREATE INDEX "proposals_opportunityId_idx" ON "proposals"("opportunityId");

-- CreateIndex
CREATE INDEX "proposals_clientId_idx" ON "proposals"("clientId");

-- CreateIndex
CREATE INDEX "proposals_validUntil_idx" ON "proposals"("validUntil");

-- CreateIndex
CREATE INDEX "proposals_currency_idx" ON "proposals"("currency");

-- CreateIndex
CREATE INDEX "proposals_updatedAt_idx" ON "proposals"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_companyId_proposalNumber_key" ON "proposals"("companyId", "proposalNumber");

-- CreateIndex
CREATE INDEX "proposal_line_items_proposalId_idx" ON "proposal_line_items"("proposalId");

-- CreateIndex
CREATE INDEX "sales_approvals_companyId_idx" ON "sales_approvals"("companyId");

-- CreateIndex
CREATE INDEX "sales_approvals_companyId_status_idx" ON "sales_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_approvals_recordType_recordId_idx" ON "sales_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "sales_approvals_submittedByMemberId_idx" ON "sales_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "sales_approvals_decidedByMemberId_idx" ON "sales_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "sales_approvals_submittedAt_idx" ON "sales_approvals"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_sourceLeadId_key" ON "opportunities"("sourceLeadId");

-- CreateIndex
CREATE INDEX "opportunities_companyId_ownerMemberId_idx" ON "opportunities"("companyId", "ownerMemberId");

-- CreateIndex
CREATE INDEX "opportunities_contactId_idx" ON "opportunities"("contactId");

-- CreateIndex
CREATE INDEX "opportunities_convertedProjectId_idx" ON "opportunities"("convertedProjectId");

-- CreateIndex
CREATE INDEX "opportunities_expectedCloseDate_idx" ON "opportunities"("expectedCloseDate");

-- CreateIndex
CREATE INDEX "opportunities_actualCloseDate_idx" ON "opportunities"("actualCloseDate");

-- CreateIndex
CREATE INDEX "opportunities_currency_idx" ON "opportunities"("currency");

-- CreateIndex
CREATE INDEX "opportunities_updatedAt_idx" ON "opportunities"("updatedAt");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sourceLeadId_fkey" FOREIGN KEY ("sourceLeadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_convertedProjectId_fkey" FOREIGN KEY ("convertedProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_approvals" ADD CONSTRAINT "sales_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

