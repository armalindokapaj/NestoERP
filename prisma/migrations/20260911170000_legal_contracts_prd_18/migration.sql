-- Legal / Contracts module (PRD #18).
--
-- The V0.1 `contracts` table was a module test record from PRD #8: a reference,
-- a title, one value, a status ladder with EXPIRING in it, and `createdBy`
-- holding a user id. The real contract has a company-unique number, a type, a
-- required member owner, a lifecycle of eleven states, renewal terms,
-- termination fields, sales lineage, and parties, obligations and amendments
-- hanging off it.
--
-- There is no honest conversion between the two. `reference` is not
-- `contractNumber` under a different name — it carried no uniqueness the module
-- relies on; EXPIRING is now derived from the expiry date rather than stored
-- (PRD #18 §75, §193); and there is no owner to invent for a row that never had
-- one. So the demo rows are removed and the seed rebuilds them in the new
-- shape.
DELETE FROM "activities" WHERE "entityType" = 'Contract';
DELETE FROM "documents" WHERE "entityType" = 'contract';
DELETE FROM "contracts";

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CLIENT_AGREEMENT', 'SERVICE_AGREEMENT', 'PURCHASE_AGREEMENT', 'SUBCONTRACT', 'LEASE', 'NDA', 'CONSULTING', 'FRAMEWORK', 'EMPLOYMENT_RELATED', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractRenewalType" AS ENUM ('NONE', 'MANUAL', 'AUTO_RENEW', 'EVERGREEN');

-- CreateEnum
CREATE TYPE "ContractPartyRole" AS ENUM ('OUR_COMPANY', 'CLIENT', 'COUNTERPARTY', 'GUARANTOR', 'SUBCONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractPartyType" AS ENUM ('COMPANY', 'INDIVIDUAL', 'PUBLIC_ENTITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractObligationType" AS ENUM ('DELIVERABLE', 'NOTICE', 'PAYMENT', 'DOCUMENT', 'COMPLIANCE', 'RENEWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractObligationStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractAmendmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'SIGNED', 'ACTIVE', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractApprovalRecordType" AS ENUM ('CONTRACT', 'AMENDMENT');

-- CreateEnum
CREATE TYPE "ContractApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "ContractStatus_new" AS ENUM ('DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED', 'ARCHIVED');
ALTER TABLE "public"."contracts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "contracts" ALTER COLUMN "status" TYPE "ContractStatus_new" USING ("status"::text::"ContractStatus_new");
-- `preArchiveStatus` is added below, already typed with the new enum: the
-- generated diff assumed it existed before the swap.
ALTER TYPE "ContractStatus" RENAME TO "ContractStatus_old";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";
DROP TYPE "public"."ContractStatus_old";
ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropIndex
DROP INDEX "contracts_companyId_reference_key";

-- DropIndex
DROP INDEX "contracts_endDate_idx";

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "approvedAt",
DROP COLUMN "approvedBy",
DROP COLUMN "archivedBy",
DROP COLUMN "counterparty",
DROP COLUMN "createdBy",
DROP COLUMN "endDate",
DROP COLUMN "reference",
DROP COLUMN "startDate",
DROP COLUMN "updatedBy",
DROP COLUMN "value",
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "autoRenewalPeriodMonths" INTEGER,
ADD COLUMN     "commercialNotes" TEXT,
ADD COLUMN     "contractNumber" TEXT NOT NULL,
ADD COLUMN     "contractType" "ContractType" NOT NULL,
ADD COLUMN     "contractValue" DECIMAL(18,2),
ADD COLUMN     "counterpartyName" TEXT,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "governingLaw" TEXT,
ADD COLUMN     "jurisdiction" TEXT,
ADD COLUMN     "legalNotes" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "ownerMemberId" TEXT NOT NULL,
ADD COLUMN     "preArchiveStatus" "ContractStatus",
ADD COLUMN     "proposalId" TEXT,
ADD COLUMN     "renewalNoticeDays" INTEGER,
ADD COLUMN     "renewalType" "ContractRenewalType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "signedDate" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "terminatedByMemberId" TEXT,
ADD COLUMN     "terminationDate" TIMESTAMP(3),
ADD COLUMN     "terminationReason" TEXT,
ADD COLUMN     "updatedByMemberId" TEXT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3);

-- CreateTable
CREATE TABLE "contract_parties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "partyRole" "ContractPartyRole" NOT NULL,
    "partyType" "ContractPartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "taxId" TEXT,
    "clientId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "isPrimaryCounterparty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_obligations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "obligationType" "ContractObligationType" NOT NULL,
    "responsibleMemberId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ContractObligationStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "sourceAmendmentId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "amendmentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "ContractAmendmentStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "signedDate" TIMESTAMP(3),
    "valueDelta" DECIMAL(18,2),
    "newContractValue" DECIMAL(18,2),
    "newExpiryDate" TIMESTAMP(3),
    "previousContractValue" DECIMAL(18,2),
    "previousExpiryDate" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "ContractApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "ContractApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_parties_companyId_idx" ON "contract_parties"("companyId");

-- CreateIndex
CREATE INDEX "contract_parties_contractId_idx" ON "contract_parties"("contractId");

-- CreateIndex
CREATE INDEX "contract_parties_clientId_idx" ON "contract_parties"("clientId");

-- CreateIndex
CREATE INDEX "contract_parties_partyRole_idx" ON "contract_parties"("partyRole");

-- CreateIndex
CREATE INDEX "contract_obligations_companyId_idx" ON "contract_obligations"("companyId");

-- CreateIndex
CREATE INDEX "contract_obligations_companyId_status_idx" ON "contract_obligations"("companyId", "status");

-- CreateIndex
CREATE INDEX "contract_obligations_contractId_idx" ON "contract_obligations"("contractId");

-- CreateIndex
CREATE INDEX "contract_obligations_responsibleMemberId_idx" ON "contract_obligations"("responsibleMemberId");

-- CreateIndex
CREATE INDEX "contract_obligations_dueDate_idx" ON "contract_obligations"("dueDate");

-- CreateIndex
CREATE INDEX "contract_obligations_obligationType_idx" ON "contract_obligations"("obligationType");

-- CreateIndex
CREATE INDEX "contract_amendments_companyId_idx" ON "contract_amendments"("companyId");

-- CreateIndex
CREATE INDEX "contract_amendments_companyId_status_idx" ON "contract_amendments"("companyId", "status");

-- CreateIndex
CREATE INDEX "contract_amendments_contractId_idx" ON "contract_amendments"("contractId");

-- CreateIndex
CREATE INDEX "contract_amendments_effectiveDate_idx" ON "contract_amendments"("effectiveDate");

-- CreateIndex
CREATE INDEX "contract_amendments_newExpiryDate_idx" ON "contract_amendments"("newExpiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "contract_amendments_contractId_amendmentNumber_key" ON "contract_amendments"("contractId", "amendmentNumber");

-- CreateIndex
CREATE INDEX "contract_approvals_companyId_idx" ON "contract_approvals"("companyId");

-- CreateIndex
CREATE INDEX "contract_approvals_companyId_status_idx" ON "contract_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "contract_approvals_recordType_recordId_idx" ON "contract_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "contract_approvals_submittedByMemberId_idx" ON "contract_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "contract_approvals_decidedByMemberId_idx" ON "contract_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "contract_approvals_submittedAt_idx" ON "contract_approvals"("submittedAt");

-- CreateIndex
CREATE INDEX "contracts_companyId_expiryDate_idx" ON "contracts"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "contracts_opportunityId_idx" ON "contracts"("opportunityId");

-- CreateIndex
CREATE INDEX "contracts_proposalId_idx" ON "contracts"("proposalId");

-- CreateIndex
CREATE INDEX "contracts_ownerMemberId_idx" ON "contracts"("ownerMemberId");

-- CreateIndex
CREATE INDEX "contracts_contractType_idx" ON "contracts"("contractType");

-- CreateIndex
CREATE INDEX "contracts_effectiveDate_idx" ON "contracts"("effectiveDate");

-- CreateIndex
CREATE INDEX "contracts_expiryDate_idx" ON "contracts"("expiryDate");

-- CreateIndex
CREATE INDEX "contracts_renewalType_idx" ON "contracts"("renewalType");

-- CreateIndex
CREATE INDEX "contracts_currency_idx" ON "contracts"("currency");

-- CreateIndex
CREATE INDEX "contracts_updatedAt_idx" ON "contracts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_companyId_contractNumber_key" ON "contracts"("companyId", "contractNumber");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_responsibleMemberId_fkey" FOREIGN KEY ("responsibleMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_sourceAmendmentId_fkey" FOREIGN KEY ("sourceAmendmentId") REFERENCES "contract_amendments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_approvals" ADD CONSTRAINT "contract_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One primary counterparty per contract (PRD #18 §144, §236).
--
-- A partial unique index, because the rule is "at most one row with true" and
-- not "unique across every row" — Prisma cannot declare that, so it lives here
-- alongside the transaction that enforces it.
CREATE UNIQUE INDEX "contract_parties_one_primary_per_contract"
  ON "contract_parties" ("contractId")
  WHERE "isPrimaryCounterparty" = true;

-- One pending approval per record (PRD #18 §237, §508).
CREATE UNIQUE INDEX "contract_approvals_one_pending_per_record"
  ON "contract_approvals" ("recordType", "recordId")
  WHERE "status" = 'PENDING';

-- Values a contract may not hold (PRD #18 §241). Service validation still
-- runs first; these exist so a bug cannot write a negative agreement.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_value_non_negative" CHECK ("contractValue" IS NULL OR "contractValue" >= 0),
  ADD CONSTRAINT "contracts_notice_days_non_negative" CHECK ("renewalNoticeDays" IS NULL OR "renewalNoticeDays" >= 0),
  ADD CONSTRAINT "contracts_renewal_period_positive" CHECK ("autoRenewalPeriodMonths" IS NULL OR "autoRenewalPeriodMonths" > 0);
