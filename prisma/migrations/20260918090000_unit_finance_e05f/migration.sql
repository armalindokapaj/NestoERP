-- E-05F: a unit sale reaches Legal and Finance on the same canonical unit — the
-- contract that sells it, Sales' request for one, the payment schedule and its
-- installments, invoices for installments, and payments allocated to what they
-- settle — plus the company's Sold rule and sale approvals.
--
-- One step is not additive, on purpose. A payment used to settle exactly one
-- invoice or one expense through `payments.invoiceId` / `payments.expenseId`.
-- Every payment now settles through `payment_allocations` (E-05F §31), so each
-- existing payment becomes one allocation of its whole amount to the invoice or
-- expense it paid, keeping its id, amount, dates, reference and status; the
-- payment learns its client (from the invoice) and project (from the invoice or
-- expense); and only then are the two columns dropped. Nothing about any payment
-- is lost, and every invoice and expense reads exactly the same paid amount
-- before and after.
--
-- Contracts gain COMPLETED and a sale agreement type; nothing existing moves.

-- CreateEnum
CREATE TYPE "UnitSoldRule" AS ENUM ('RESERVATION', 'SIGNED_CONTRACT', 'DEPOSIT_RECEIVED', 'SIGNED_CONTRACT_AND_DEPOSIT', 'MANUAL_APPROVAL');

-- CreateEnum
CREATE TYPE "UnitContractRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentType" AS ENUM ('DEPOSIT', 'INSTALLMENT', 'BALANCE', 'OTHER');

-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'COMPLETED';

-- AlterEnum
ALTER TYPE "ContractType" ADD VALUE 'SALE_AGREEMENT';

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "unitSoldRule" "UnitSoldRule" NOT NULL DEFAULT 'SIGNED_CONTRACT';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedByMemberId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "installmentId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "replacesPaymentId" TEXT;

-- CreateTable
CREATE TABLE "unit_sale_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordType" "UnitApprovalRecordType" NOT NULL DEFAULT 'UNIT',
    "recordId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" "UnitApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionNote" TEXT,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_sale_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "contractId" TEXT,
    "installmentId" TEXT,
    "invoiceId" TEXT,
    "expenseId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedByMemberId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL,
    "notes" TEXT,
    "totalExceptionReason" TEXT,
    "totalExceptionByMemberId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedByMemberId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByScheduleId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByMemberId" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_installments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" "InstallmentType" NOT NULL DEFAULT 'INSTALLMENT',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "value" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "valueNote" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedByMemberId" TEXT,
    "releaseReason" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_contract_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" "UnitContractRequestStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "requestedByMemberId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contractId" TEXT,
    "closedByMemberId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_contract_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_sale_approvals_companyId_idx" ON "unit_sale_approvals"("companyId");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_companyId_status_idx" ON "unit_sale_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_recordType_recordId_idx" ON "unit_sale_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_reservationId_idx" ON "unit_sale_approvals"("reservationId");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_submittedByMemberId_idx" ON "unit_sale_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_decidedByMemberId_idx" ON "unit_sale_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "unit_sale_approvals_submittedAt_idx" ON "unit_sale_approvals"("submittedAt");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_contractId_idx" ON "payment_allocations"("contractId");

-- CreateIndex
CREATE INDEX "payment_allocations_installmentId_idx" ON "payment_allocations"("installmentId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_expenseId_idx" ON "payment_allocations"("expenseId");

-- CreateIndex
CREATE INDEX "payment_schedules_contractId_status_idx" ON "payment_schedules"("contractId", "status");

-- CreateIndex
CREATE INDEX "payment_schedules_companyId_status_idx" ON "payment_schedules"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_schedules_contractId_versionNumber_key" ON "payment_schedules"("contractId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_schedules_id_contractId_key" ON "payment_schedules"("id", "contractId");

-- CreateIndex
CREATE INDEX "payment_installments_scheduleId_dueDate_idx" ON "payment_installments"("scheduleId", "dueDate");

-- CreateIndex
CREATE INDEX "payment_installments_contractId_dueDate_idx" ON "payment_installments"("contractId", "dueDate");

-- CreateIndex
CREATE INDEX "payment_installments_companyId_idx" ON "payment_installments"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installments_scheduleId_sequence_key" ON "payment_installments"("scheduleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installments_id_contractId_key" ON "payment_installments"("id", "contractId");

-- CreateIndex
CREATE INDEX "contract_units_unitId_idx" ON "contract_units"("unitId");

-- CreateIndex
CREATE INDEX "contract_units_companyId_projectId_idx" ON "contract_units"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_units_contractId_unitId_key" ON "contract_units"("contractId", "unitId");

-- CreateIndex
CREATE INDEX "unit_contract_requests_companyId_status_requestedAt_idx" ON "unit_contract_requests"("companyId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "unit_contract_requests_unitId_status_idx" ON "unit_contract_requests"("unitId", "status");

-- CreateIndex
CREATE INDEX "unit_contract_requests_reservationId_idx" ON "unit_contract_requests"("reservationId");

-- CreateIndex
CREATE INDEX "unit_contract_requests_contractId_idx" ON "unit_contract_requests"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_companyId_key" ON "contracts"("id", "companyId");

-- CreateIndex
CREATE INDEX "invoices_contractId_status_idx" ON "invoices"("contractId", "status");

-- CreateIndex
CREATE INDEX "invoices_installmentId_idx" ON "invoices"("installmentId");

-- CreateIndex
CREATE INDEX "payments_clientId_paymentDate_idx" ON "payments"("clientId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_contractId_paymentDate_idx" ON "payments"("contractId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_projectId_idx" ON "payments"("projectId");

-- CreateIndex
CREATE INDEX "payments_replacesPaymentId_idx" ON "payments"("replacesPaymentId");

-- AddForeignKey
ALTER TABLE "unit_sale_approvals" ADD CONSTRAINT "unit_sale_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_sale_approvals" ADD CONSTRAINT "unit_sale_approvals_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "unit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_installmentId_contractId_fkey" FOREIGN KEY ("installmentId", "contractId") REFERENCES "payment_installments"("id", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_replacesPaymentId_fkey" FOREIGN KEY ("replacesPaymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installmentId_contractId_fkey" FOREIGN KEY ("installmentId", "contractId") REFERENCES "payment_installments"("id", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_contractId_companyId_fkey" FOREIGN KEY ("contractId", "companyId") REFERENCES "contracts"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_scheduleId_contractId_fkey" FOREIGN KEY ("scheduleId", "contractId") REFERENCES "payment_schedules"("id", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_units" ADD CONSTRAINT "contract_units_contractId_companyId_fkey" FOREIGN KEY ("contractId", "companyId") REFERENCES "contracts"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_units" ADD CONSTRAINT "contract_units_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_contract_requests" ADD CONSTRAINT "unit_contract_requests_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_contract_requests" ADD CONSTRAINT "unit_contract_requests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "unit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_contract_requests" ADD CONSTRAINT "unit_contract_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_contract_requests" ADD CONSTRAINT "unit_contract_requests_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_contract_requests" ADD CONSTRAINT "unit_contract_requests_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (E-05F §114): every existing payment keeps its id, amount, date,
-- reference and status, and becomes one allocation to what it settled. Voided
-- payments keep theirs too; an allocation of a voided payment counts for nothing,
-- exactly as the voided payment did.
UPDATE "payments" p
SET "clientId" = i."clientId", "projectId" = i."projectId"
FROM "invoices" i
WHERE p."invoiceId" = i."id";

UPDATE "payments" p
SET "projectId" = e."projectId"
FROM "expenses" e
WHERE p."expenseId" = e."id";

INSERT INTO "payment_allocations" ("id", "companyId", "paymentId", "invoiceId", "expenseId", "amount", "createdByMemberId", "createdAt")
SELECT 'alloc_' || p."id", p."companyId", p."id", p."invoiceId", p."expenseId", p."amount", p."createdByMemberId", p."createdAt"
FROM "payments" p
WHERE p."invoiceId" IS NOT NULL OR p."expenseId" IS NOT NULL;

-- Only now do the old single-parent links go.
ALTER TABLE "payments" DROP CONSTRAINT "payment_exactly_one_parent";
ALTER TABLE "payments" DROP CONSTRAINT "payments_expenseId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_invoiceId_fkey";
DROP INDEX "payments_expenseId_idx";
DROP INDEX "payments_invoiceId_idx";
ALTER TABLE "payments" DROP COLUMN "expenseId", DROP COLUMN "invoiceId";

-- A receipt says who paid; a disbursement pays no client and no sale contract.
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_names_client" CHECK ("direction" <> 'RECEIPT' OR "clientId" IS NOT NULL);
ALTER TABLE "payments" ADD CONSTRAINT "payments_disbursement_has_no_client" CHECK ("direction" = 'RECEIPT' OR ("clientId" IS NULL AND "contractId" IS NULL));

-- An allocation settles an expense alone, or an installment and/or an invoice;
-- it names a contract exactly when it names an installment, and moves money (§72, §79).
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_one_target" CHECK (
  ("expenseId" IS NOT NULL AND "installmentId" IS NULL AND "invoiceId" IS NULL)
  OR ("expenseId" IS NULL AND ("installmentId" IS NOT NULL OR "invoiceId" IS NOT NULL))
);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_contract_with_installment" CHECK (("installmentId" IS NULL) = ("contractId" IS NULL));

-- An invoice for an installment always names that installment's contract, so the
-- composite foreign key is checked rather than skipped (§26).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_installment_names_contract" CHECK ("installmentId" IS NULL OR "contractId" IS NOT NULL);

-- Money is never negative (§73, §110).
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_sequence_positive" CHECK ("sequence" >= 1);
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_version_positive" CHECK ("versionNumber" >= 1);
ALTER TABLE "contract_units" ADD CONSTRAINT "contract_units_value_non_negative" CHECK ("value" IS NULL OR "value" >= 0);

-- One live contract per unit (§8), one open contract request per unit (§12), one
-- active and one draft schedule per contract (§20, §25), one live invoice per
-- installment (§26), and one pending sale approval per unit (§42). Two people
-- acting at once leave one row and one refusal. Prisma cannot express a partial
-- index, so they are written here.
CREATE UNIQUE INDEX "contract_units_one_live_per_unit" ON "contract_units"("unitId") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "unit_contract_requests_one_open_per_unit" ON "unit_contract_requests"("unitId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "payment_schedules_one_active_per_contract" ON "payment_schedules"("contractId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "payment_schedules_one_draft_per_contract" ON "payment_schedules"("contractId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "invoices_one_live_per_installment" ON "invoices"("installmentId") WHERE "installmentId" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'ARCHIVED');
CREATE UNIQUE INDEX "unit_sale_approvals_one_pending_per_unit" ON "unit_sale_approvals"("recordId") WHERE "status" = 'PENDING';
