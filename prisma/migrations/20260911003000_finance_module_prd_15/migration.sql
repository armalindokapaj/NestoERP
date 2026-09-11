-- Finance module (PRD #15).
--
-- The V0.1 `invoices` table was a module test record from PRD #8: a title, one
-- amount and a status that mixed issuance with settlement. The real invoice has
-- line items it derives its totals from, a workflow status that says nothing
-- about payment, and a mandatory client.
--
-- There is no honest conversion between the two. A single `amount` cannot be
-- decomposed into lines, and `PAID`/`OVERDUE` are settlement facts the new
-- model derives from payments rather than stores. So the demo rows are removed
-- and the seed rebuilds them in the new shape, rather than inventing a line
-- item per invoice and pretending it was always there.
DELETE FROM "activities" WHERE "entityType" = 'Invoice';
DELETE FROM "invoices";

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIPT', 'DISBURSEMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FinanceCostCategory" AS ENUM ('LABOR', 'MATERIALS', 'EQUIPMENT', 'SUBCONTRACTOR', 'SERVICES', 'TRAVEL', 'ADMINISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FinanceApprovalRecordType" AS ENUM ('INVOICE', 'EXPENSE', 'BUDGET', 'COMMITMENT');

-- CreateEnum
CREATE TYPE "FinanceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'CANCELLED', 'ARCHIVED');
ALTER TABLE "public"."invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
-- `preArchiveStatus` is added below, already typed with the new enum: the
-- generated diff assumed it existed before the swap.
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "public"."InvoiceStatus_old";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_clientId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_ownerMemberId_fkey";

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "amount",
DROP COLUMN "approvedAt",
DROP COLUMN "approvedBy",
DROP COLUMN "archivedBy",
DROP COLUMN "createdBy",
DROP COLUMN "ownerMemberId",
DROP COLUMN "title",
DROP COLUMN "updatedBy",
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "preArchiveStatus" "InvoiceStatus",
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "subtotal" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "totalAmount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "updatedByMemberId" TEXT,
ALTER COLUMN "clientId" SET NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3),
ALTER COLUMN "issueDate" SET NOT NULL,
ALTER COLUMN "dueDate" SET NOT NULL;

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "invoicePrefix" TEXT,
    "defaultTaxRate" DECIMAL(7,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
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

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseNumber" TEXT,
    "projectId" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "category" "FinanceCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "payeeName" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "preArchiveStatus" "ExpenseStatus",
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "invoiceId" TEXT,
    "expenseId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "createdByMemberId" TEXT NOT NULL,
    "voidedByMemberId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budgets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "preArchiveStatus" "BudgetStatus",
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budget_line_items" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "category" "FinanceCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "plannedAmount" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_budget_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "category" "FinanceCostCategory" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "status" "CommitmentStatus" NOT NULL DEFAULT 'DRAFT',
    "preArchiveStatus" "CommitmentStatus",
    "sourceModule" TEXT,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "FinanceApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "FinanceApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_companyId_key" ON "finance_settings"("companyId");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- CreateIndex
CREATE INDEX "expenses_companyId_idx" ON "expenses"("companyId");

-- CreateIndex
CREATE INDEX "expenses_companyId_status_idx" ON "expenses"("companyId", "status");

-- CreateIndex
CREATE INDEX "expenses_companyId_expenseDate_idx" ON "expenses"("companyId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_projectId_idx" ON "expenses"("projectId");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_currency_idx" ON "expenses"("currency");

-- CreateIndex
CREATE INDEX "expenses_updatedAt_idx" ON "expenses"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_companyId_expenseNumber_key" ON "expenses"("companyId", "expenseNumber");

-- CreateIndex
CREATE INDEX "payments_companyId_idx" ON "payments"("companyId");

-- CreateIndex
CREATE INDEX "payments_companyId_status_idx" ON "payments"("companyId", "status");

-- CreateIndex
CREATE INDEX "payments_companyId_paymentDate_idx" ON "payments"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_expenseId_idx" ON "payments"("expenseId");

-- CreateIndex
CREATE INDEX "payments_direction_idx" ON "payments"("direction");

-- CreateIndex
CREATE INDEX "payments_currency_idx" ON "payments"("currency");

-- CreateIndex
CREATE INDEX "project_budgets_companyId_idx" ON "project_budgets"("companyId");

-- CreateIndex
CREATE INDEX "project_budgets_companyId_status_idx" ON "project_budgets"("companyId", "status");

-- CreateIndex
CREATE INDEX "project_budgets_projectId_idx" ON "project_budgets"("projectId");

-- CreateIndex
CREATE INDEX "project_budgets_projectId_isCurrent_idx" ON "project_budgets"("projectId", "isCurrent");

-- CreateIndex
CREATE INDEX "project_budgets_currency_idx" ON "project_budgets"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "project_budgets_projectId_version_key" ON "project_budgets"("projectId", "version");

-- CreateIndex
CREATE INDEX "project_budget_line_items_budgetId_idx" ON "project_budget_line_items"("budgetId");

-- CreateIndex
CREATE INDEX "project_budget_line_items_category_idx" ON "project_budget_line_items"("category");

-- CreateIndex
CREATE INDEX "commitments_companyId_idx" ON "commitments"("companyId");

-- CreateIndex
CREATE INDEX "commitments_companyId_status_idx" ON "commitments"("companyId", "status");

-- CreateIndex
CREATE INDEX "commitments_projectId_idx" ON "commitments"("projectId");

-- CreateIndex
CREATE INDEX "commitments_category_idx" ON "commitments"("category");

-- CreateIndex
CREATE INDEX "commitments_expectedDate_idx" ON "commitments"("expectedDate");

-- CreateIndex
CREATE INDEX "commitments_currency_idx" ON "commitments"("currency");

-- CreateIndex
CREATE INDEX "commitments_sourceModule_sourceEntityType_sourceEntityId_idx" ON "commitments"("sourceModule", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "finance_approvals_companyId_idx" ON "finance_approvals"("companyId");

-- CreateIndex
CREATE INDEX "finance_approvals_companyId_status_idx" ON "finance_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "finance_approvals_recordType_recordId_idx" ON "finance_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "finance_approvals_submittedByMemberId_idx" ON "finance_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "finance_approvals_decidedByMemberId_idx" ON "finance_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "finance_approvals_submittedAt_idx" ON "finance_approvals"("submittedAt");

-- CreateIndex
CREATE INDEX "invoices_companyId_dueDate_idx" ON "invoices"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "invoices_issueDate_idx" ON "invoices"("issueDate");

-- CreateIndex
CREATE INDEX "invoices_currency_idx" ON "invoices"("currency");

-- CreateIndex
CREATE INDEX "invoices_updatedAt_idx" ON "invoices"("updatedAt");

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budget_line_items" ADD CONSTRAINT "project_budget_line_items_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "project_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approvals" ADD CONSTRAINT "finance_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One current budget per project (PRD #15 §201).
--
-- Approving a revision stands the previous version down in the same
-- transaction; this is that rule stated where two concurrent approvals would
-- otherwise race. Prisma cannot express a partial index, so it is written here.
CREATE UNIQUE INDEX "project_budget_one_current"
ON "project_budgets" ("projectId")
WHERE "isCurrent" = true;

-- A payment settles exactly one invoice or one expense — never both, never
-- neither (PRD #15 §74, §200). The service enforces it too; this is the
-- guarantee that survives a bug in the service.
ALTER TABLE "payments"
ADD CONSTRAINT "payment_exactly_one_parent"
CHECK (
  ("invoiceId" IS NOT NULL AND "expenseId" IS NULL)
  OR ("invoiceId" IS NULL AND "expenseId" IS NOT NULL)
);

-- Money is never negative anywhere in V0.1: there are no credit notes and no
-- refunds, so a negative amount is a bug rather than a business case
-- (PRD #15 §200, §414, §415).
ALTER TABLE "payments" ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "invoices" ADD CONSTRAINT "invoice_amounts_non_negative"
CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0);

ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_amounts_valid"
CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "taxRate" >= 0 AND "subtotal" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0);

ALTER TABLE "expenses" ADD CONSTRAINT "expense_amounts_valid"
CHECK ("netAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" > 0);

ALTER TABLE "project_budgets" ADD CONSTRAINT "budget_total_non_negative"
CHECK ("totalAmount" >= 0);

ALTER TABLE "project_budget_line_items" ADD CONSTRAINT "budget_line_non_negative"
CHECK ("plannedAmount" >= 0);

ALTER TABLE "commitments" ADD CONSTRAINT "commitment_amount_positive"
CHECK ("amount" > 0);

-- Finance settings must stay usable: a fiscal year cannot start in month 13,
-- and payment terms cannot run backwards (PRD #15 §200).
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_sane"
CHECK (
  "fiscalYearStartMonth" BETWEEN 1 AND 12
  AND "defaultPaymentTermsDays" >= 0
);

-- Invoices need a creator, and the rows that predate this migration are gone,
-- so the column can take its NOT NULL without a placeholder member.
