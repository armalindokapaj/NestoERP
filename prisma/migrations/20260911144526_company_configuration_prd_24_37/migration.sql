-- CreateEnum
CREATE TYPE "NumberingMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "NumberingYearMode" AS ENUM ('NONE', 'YYYY', 'YY');

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_companyId_fkey";

-- DropForeignKey
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_companyId_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_companyId_fkey";

-- DropForeignKey
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_companyId_fkey";

-- DropForeignKey
ALTER TABLE "company_members" DROP CONSTRAINT "company_members_companyId_fkey";

-- DropForeignKey
ALTER TABLE "company_modules" DROP CONSTRAINT "company_modules_companyId_fkey";

-- DropForeignKey
ALTER TABLE "compensations" DROP CONSTRAINT "compensations_companyId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_companyId_fkey";

-- DropForeignKey
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_companyId_fkey";

-- DropForeignKey
ALTER TABLE "departments" DROP CONSTRAINT "departments_companyId_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_companyId_fkey";

-- DropForeignKey
ALTER TABLE "employee_profiles" DROP CONSTRAINT "employee_profiles_companyId_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_companyId_fkey";

-- DropForeignKey
ALTER TABLE "finance_approvals" DROP CONSTRAINT "finance_approvals_companyId_fkey";

-- DropForeignKey
ALTER TABLE "finance_settings" DROP CONSTRAINT "finance_settings_companyId_fkey";

-- DropForeignKey
ALTER TABLE "hse_records" DROP CONSTRAINT "hse_records_companyId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_companyId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_companyId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_companyId_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_companyId_fkey";

-- DropForeignKey
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_companyId_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_companyId_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_companyId_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_companyId_fkey";

-- DropForeignKey
ALTER TABLE "project_budgets" DROP CONSTRAINT "project_budgets_companyId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_companyId_fkey";

-- DropForeignKey
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_companyId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_companyId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_companyId_fkey";

-- DropForeignKey
ALTER TABLE "quality_records" DROP CONSTRAINT "quality_records_companyId_fkey";

-- DropForeignKey
ALTER TABLE "sales_approvals" DROP CONSTRAINT "sales_approvals_companyId_fkey";

-- DropForeignKey
ALTER TABLE "support_requests" DROP CONSTRAINT "support_requests_companyId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_companyId_fkey";

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "configVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "company_members" ADD COLUMN     "accessVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "defaultTaxRate" DECIMAL(9,4),
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_integration_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "qualityGateForInventoryReceipts" BOOLEAN NOT NULL DEFAULT false,
    "autoCreateFinanceCommitmentFromApprovedPo" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_numbering_schemes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "mode" "NumberingMode" NOT NULL DEFAULT 'MANUAL',
    "prefix" TEXT,
    "separator" TEXT NOT NULL DEFAULT '-',
    "yearMode" "NumberingYearMode" NOT NULL DEFAULT 'YYYY',
    "padding" INTEGER NOT NULL DEFAULT 4,
    "resetSequenceYearly" BOOLEAN NOT NULL DEFAULT true,
    "currentYear" INTEGER,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_numbering_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_companyId_key" ON "company_settings"("companyId");

-- CreateIndex
CREATE INDEX "company_settings_baseCurrency_idx" ON "company_settings"("baseCurrency");

-- CreateIndex
CREATE INDEX "company_settings_timezone_idx" ON "company_settings"("timezone");

-- CreateIndex
CREATE UNIQUE INDEX "company_integration_settings_companyId_key" ON "company_integration_settings"("companyId");

-- CreateIndex
CREATE INDEX "company_numbering_schemes_companyId_idx" ON "company_numbering_schemes"("companyId");

-- CreateIndex
CREATE INDEX "company_numbering_schemes_moduleKey_entityType_idx" ON "company_numbering_schemes"("moduleKey", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "company_numbering_schemes_companyId_moduleKey_entityType_key" ON "company_numbering_schemes"("companyId", "moduleKey", "entityType");

-- CreateIndex
CREATE INDEX "activities_correlationId_idx" ON "activities"("correlationId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approvals" ADD CONSTRAINT "finance_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_approvals" ADD CONSTRAINT "sales_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_records" ADD CONSTRAINT "quality_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_records" ADD CONSTRAINT "hse_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_integration_settings" ADD CONSTRAINT "company_integration_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_numbering_schemes" ADD CONSTRAINT "company_numbering_schemes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
