-- Procurement module (PRD #19).
--
-- The V0.1 `purchase_requests` and `purchase_orders` tables were module test
-- records from PRD #8: a reference, a title, one amount, a supplier held as a
-- free-text string, and a short status ladder. The real module has a canonical
-- Supplier record, line items on every document, an RFQ and quote-comparison
-- stage between the request and the order, goods receipts that settle against
-- ordered quantity, and its own approval cycle.
--
-- There is no honest conversion between the two. `supplier` was a name nobody
-- could open; `amount` was a total with no lines behind it to price; and a
-- request had no requester the module could rely on. So the demo rows are
-- removed and the seed rebuilds them in the new shape.
DELETE FROM "activities" WHERE "entityType" IN ('PurchaseRequest', 'PurchaseOrder');
DELETE FROM "documents" WHERE "entityType" IN ('purchase-request', 'purchase-order', 'request', 'order');
DELETE FROM "purchase_orders";
DELETE FROM "purchase_requests";
-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('COMPANY', 'INDIVIDUAL', 'PUBLIC_ENTITY', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProcurementPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProcurementCategory" AS ENUM ('MATERIALS', 'EQUIPMENT', 'SUBCONTRACT', 'SERVICES', 'LOGISTICS', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "RFQStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RFQSupplierStatus" AS ENUM ('INVITED', 'RESPONDED', 'DECLINED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "SupplierQuoteStatus" AS ENUM ('DRAFT', 'RECEIVED', 'DISQUALIFIED', 'SELECTED', 'NOT_SELECTED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ProcurementApprovalRecordType" AS ENUM ('PURCHASE_REQUEST', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "ProcurementApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "PurchaseOrderStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED', 'ARCHIVED');
ALTER TABLE "public"."purchase_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "purchase_orders" ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new" USING ("status"::text::"PurchaseOrderStatus_new");
ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";
DROP TYPE "public"."PurchaseOrderStatus_old";
ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PurchaseRequestStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_SOURCING', 'PARTIALLY_ORDERED', 'ORDERED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
ALTER TABLE "public"."purchase_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "purchase_requests" ALTER COLUMN "status" TYPE "PurchaseRequestStatus_new" USING ("status"::text::"PurchaseRequestStatus_new");
ALTER TYPE "PurchaseRequestStatus" RENAME TO "PurchaseRequestStatus_old";
ALTER TYPE "PurchaseRequestStatus_new" RENAME TO "PurchaseRequestStatus";
DROP TYPE "public"."PurchaseRequestStatus_old";
ALTER TABLE "purchase_requests" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_companyId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_requestId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_companyId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_requestedMemberId_fkey";

-- DropIndex
DROP INDEX "purchase_orders_companyId_reference_key";

-- DropIndex
DROP INDEX "purchase_requests_companyId_reference_key";

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "amount",
DROP COLUMN "approvedBy",
DROP COLUMN "createdBy",
DROP COLUMN "expectedAt",
DROP COLUMN "orderedAt",
DROP COLUMN "reference",
DROP COLUMN "requestId",
DROP COLUMN "supplier",
DROP COLUMN "updatedBy",
ADD COLUMN     "approvedByMemberId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "financeCommitmentId" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "modifiedFromQuote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "orderDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "poNumber" TEXT NOT NULL,
ADD COLUMN     "preArchiveStatus" "PurchaseOrderStatus",
ADD COLUMN     "purchaseRequestId" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByMemberId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requiredDate" TIMESTAMP(3),
ADD COLUMN     "rfqId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "subtotal" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "supplierId" TEXT NOT NULL,
ADD COLUMN     "supplierQuoteId" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "totalAmount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "updatedByMemberId" TEXT,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3);

-- AlterTable
ALTER TABLE "purchase_requests" DROP COLUMN "amount",
DROP COLUMN "approvedBy",
DROP COLUMN "createdBy",
DROP COLUMN "neededBy",
DROP COLUMN "reference",
DROP COLUMN "requestedMemberId",
DROP COLUMN "updatedBy",
ADD COLUMN     "approvedByMemberId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimatedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ownerMemberId" TEXT,
ADD COLUMN     "preArchiveStatus" "PurchaseRequestStatus",
ADD COLUMN     "priority" "ProcurementPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByMemberId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestNumber" TEXT NOT NULL,
ADD COLUMN     "requestedByMemberId" TEXT NOT NULL,
ADD COLUMN     "requiredDate" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "updatedByMemberId" TEXT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "supplierType" "SupplierType" NOT NULL DEFAULT 'COMPANY',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "registrationNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentTermsDays" INTEGER,
    "defaultCurrency" VARCHAR(3),
    "notes" TEXT,
    "normalizedName" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "estimatedUnitPrice" DECIMAL(18,4),
    "estimatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "category" "ProcurementCategory",
    "specification" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purchaseRequestId" TEXT,
    "projectId" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "responseDueDate" TIMESTAMP(3),
    "status" "RFQStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_suppliers" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "RFQSupplierStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_items" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "sourceRequestItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "specification" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteNumber" TEXT,
    "quoteDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "deliveryDate" TIMESTAMP(3),
    "status" "SupplierQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "disqualificationReason" TEXT,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_items" (
    "id" TEXT NOT NULL,
    "supplierQuoteId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sourceRequestItemId" TEXT,
    "sourceQuoteItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplierId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "deliveryReference" TEXT,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'RECORDED',
    "receivedByMemberId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "voidedByMemberId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(18,4) NOT NULL,
    "acceptedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "ProcurementApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "ProcurementApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_companyId_idx" ON "suppliers"("companyId");

-- CreateIndex
CREATE INDEX "suppliers_companyId_status_idx" ON "suppliers"("companyId", "status");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "suppliers_normalizedName_idx" ON "suppliers"("normalizedName");

-- CreateIndex
CREATE INDEX "suppliers_taxId_idx" ON "suppliers"("taxId");

-- CreateIndex
CREATE INDEX "suppliers_registrationNumber_idx" ON "suppliers"("registrationNumber");

-- CreateIndex
CREATE INDEX "suppliers_country_idx" ON "suppliers"("country");

-- CreateIndex
CREATE INDEX "suppliers_updatedAt_idx" ON "suppliers"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_code_key" ON "suppliers"("companyId", "code");

-- CreateIndex
CREATE INDEX "purchase_request_items_purchaseRequestId_idx" ON "purchase_request_items"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "purchase_request_items_category_idx" ON "purchase_request_items"("category");

-- CreateIndex
CREATE INDEX "rfqs_companyId_idx" ON "rfqs"("companyId");

-- CreateIndex
CREATE INDEX "rfqs_companyId_status_idx" ON "rfqs"("companyId", "status");

-- CreateIndex
CREATE INDEX "rfqs_purchaseRequestId_idx" ON "rfqs"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "rfqs_projectId_idx" ON "rfqs"("projectId");

-- CreateIndex
CREATE INDEX "rfqs_responseDueDate_idx" ON "rfqs"("responseDueDate");

-- CreateIndex
CREATE INDEX "rfqs_updatedAt_idx" ON "rfqs"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_companyId_rfqNumber_key" ON "rfqs"("companyId", "rfqNumber");

-- CreateIndex
CREATE INDEX "rfq_suppliers_rfqId_idx" ON "rfq_suppliers"("rfqId");

-- CreateIndex
CREATE INDEX "rfq_suppliers_supplierId_idx" ON "rfq_suppliers"("supplierId");

-- CreateIndex
CREATE INDEX "rfq_suppliers_status_idx" ON "rfq_suppliers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_suppliers_rfqId_supplierId_key" ON "rfq_suppliers"("rfqId", "supplierId");

-- CreateIndex
CREATE INDEX "rfq_items_rfqId_idx" ON "rfq_items"("rfqId");

-- CreateIndex
CREATE INDEX "rfq_items_sourceRequestItemId_idx" ON "rfq_items"("sourceRequestItemId");

-- CreateIndex
CREATE INDEX "supplier_quotes_companyId_idx" ON "supplier_quotes"("companyId");

-- CreateIndex
CREATE INDEX "supplier_quotes_companyId_status_idx" ON "supplier_quotes"("companyId", "status");

-- CreateIndex
CREATE INDEX "supplier_quotes_rfqId_idx" ON "supplier_quotes"("rfqId");

-- CreateIndex
CREATE INDEX "supplier_quotes_supplierId_idx" ON "supplier_quotes"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_quotes_quoteDate_idx" ON "supplier_quotes"("quoteDate");

-- CreateIndex
CREATE INDEX "supplier_quotes_validUntil_idx" ON "supplier_quotes"("validUntil");

-- CreateIndex
CREATE INDEX "supplier_quotes_currency_idx" ON "supplier_quotes"("currency");

-- CreateIndex
CREATE INDEX "supplier_quote_items_supplierQuoteId_idx" ON "supplier_quote_items"("supplierQuoteId");

-- CreateIndex
CREATE INDEX "supplier_quote_items_rfqItemId_idx" ON "supplier_quote_items"("rfqItemId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quote_items_supplierQuoteId_rfqItemId_key" ON "supplier_quote_items"("supplierQuoteId", "rfqItemId");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_items_sourceRequestItemId_idx" ON "purchase_order_items"("sourceRequestItemId");

-- CreateIndex
CREATE INDEX "purchase_order_items_sourceQuoteItemId_idx" ON "purchase_order_items"("sourceQuoteItemId");

-- CreateIndex
CREATE INDEX "goods_receipts_companyId_idx" ON "goods_receipts"("companyId");

-- CreateIndex
CREATE INDEX "goods_receipts_companyId_status_idx" ON "goods_receipts"("companyId", "status");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "goods_receipts"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "goods_receipts_projectId_idx" ON "goods_receipts"("projectId");

-- CreateIndex
CREATE INDEX "goods_receipts_supplierId_idx" ON "goods_receipts"("supplierId");

-- CreateIndex
CREATE INDEX "goods_receipts_receiptDate_idx" ON "goods_receipts"("receiptDate");

-- CreateIndex
CREATE INDEX "goods_receipts_receivedByMemberId_idx" ON "goods_receipts"("receivedByMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_companyId_receiptNumber_key" ON "goods_receipts"("companyId", "receiptNumber");

-- CreateIndex
CREATE INDEX "goods_receipt_items_goodsReceiptId_idx" ON "goods_receipt_items"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchaseOrderItemId_idx" ON "goods_receipt_items"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "procurement_approvals_companyId_idx" ON "procurement_approvals"("companyId");

-- CreateIndex
CREATE INDEX "procurement_approvals_companyId_status_idx" ON "procurement_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "procurement_approvals_recordType_recordId_idx" ON "procurement_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "procurement_approvals_submittedByMemberId_idx" ON "procurement_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "procurement_approvals_decidedByMemberId_idx" ON "procurement_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "procurement_approvals_submittedAt_idx" ON "procurement_approvals"("submittedAt");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_orders_purchaseRequestId_idx" ON "purchase_orders"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "purchase_orders_rfqId_idx" ON "purchase_orders"("rfqId");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierQuoteId_idx" ON "purchase_orders"("supplierQuoteId");

-- CreateIndex
CREATE INDEX "purchase_orders_contractId_idx" ON "purchase_orders"("contractId");

-- CreateIndex
CREATE INDEX "purchase_orders_financeCommitmentId_idx" ON "purchase_orders"("financeCommitmentId");

-- CreateIndex
CREATE INDEX "purchase_orders_orderDate_idx" ON "purchase_orders"("orderDate");

-- CreateIndex
CREATE INDEX "purchase_orders_requiredDate_idx" ON "purchase_orders"("requiredDate");

-- CreateIndex
CREATE INDEX "purchase_orders_currency_idx" ON "purchase_orders"("currency");

-- CreateIndex
CREATE INDEX "purchase_orders_updatedAt_idx" ON "purchase_orders"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_companyId_poNumber_key" ON "purchase_orders"("companyId", "poNumber");

-- CreateIndex
CREATE INDEX "purchase_requests_departmentId_idx" ON "purchase_requests"("departmentId");

-- CreateIndex
CREATE INDEX "purchase_requests_requestedByMemberId_idx" ON "purchase_requests"("requestedByMemberId");

-- CreateIndex
CREATE INDEX "purchase_requests_ownerMemberId_idx" ON "purchase_requests"("ownerMemberId");

-- CreateIndex
CREATE INDEX "purchase_requests_requiredDate_idx" ON "purchase_requests"("requiredDate");

-- CreateIndex
CREATE INDEX "purchase_requests_priority_idx" ON "purchase_requests"("priority");

-- CreateIndex
CREATE INDEX "purchase_requests_updatedAt_idx" ON "purchase_requests"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_companyId_requestNumber_key" ON "purchase_requests"("companyId", "requestNumber");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requestedByMemberId_fkey" FOREIGN KEY ("requestedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "rfq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receivedByMemberId_fkey" FOREIGN KEY ("receivedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_approvals" ADD CONSTRAINT "procurement_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

