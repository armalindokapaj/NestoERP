-- Inventory module (PRD #20).
--
-- The V0.1 `inventory_items` and `inventory_movements` tables were module test
-- records from PRD #8: an item carried its own integer `quantity` and a single
-- free-text `location`, and a movement was an integer in or out with no place
-- attached to it.
--
-- The real module separates the two things that table conflated. An item is a
-- *kind* of thing; how much of it exists lives in `inventory_balances`, one row
-- per item per location, projected from an append-only `stock_movements` ledger
-- (PRD #20 §67, §79). Quantities are decimals, not integers, because cement is
-- bought by the cubic metre. Stock sits in a warehouse and a location, both of
-- which are real records rather than a string.
--
-- There is no honest conversion between the two. An integer `quantity` on the
-- item has no ledger behind it to explain it, and `location` as text cannot
-- become a foreign key to rows that do not exist. So the demo rows are removed
-- and the seed rebuilds them in the new shape.
DELETE FROM "activities" WHERE "entityType" IN ('InventoryItem', 'InventoryMovement');
DELETE FROM "documents" WHERE "entityType" IN ('inventory-item', 'item', 'movement');
DELETE FROM "inventory_movements";
DELETE FROM "inventory_items";
-- CreateEnum
CREATE TYPE "InventoryItemCategory" AS ENUM ('MATERIAL', 'EQUIPMENT', 'TOOL', 'CONSUMABLE', 'SPARE_PART', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryItemStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL', 'PROJECT_SITE', 'OFFICE', 'TEMPORARY', 'OTHER');

-- CreateEnum
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InventoryLocationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN_TO_STOCK', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "InventoryTransactionStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('OPENING_BALANCE', 'PHYSICAL_COUNT', 'DAMAGE', 'LOSS', 'FOUND', 'CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RELEASED', 'CANCELLED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_companyId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_actorMemberId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_companyId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_itemId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_projectId_fkey";

-- AlterTable
ALTER TABLE "inventory_items" DROP COLUMN "archivedBy",
DROP COLUMN "createdBy",
DROP COLUMN "location",
DROP COLUMN "quantity",
DROP COLUMN "reorderLevel",
DROP COLUMN "unit",
DROP COLUMN "unitCost",
DROP COLUMN "updatedBy",
ADD COLUMN     "archivedByMemberId" TEXT,
ADD COLUMN     "baseUnit" TEXT NOT NULL,
ADD COLUMN     "category" "InventoryItemCategory" NOT NULL,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "defaultLocationId" TEXT,
ADD COLUMN     "defaultWarehouseId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "minimumStock" DECIMAL(18,4),
ADD COLUMN     "reorderPoint" DECIMAL(18,4),
ADD COLUMN     "status" "InventoryItemStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedByMemberId" TEXT;

-- DropTable
DROP TABLE "inventory_movements";

-- DropEnum
DROP TYPE "MovementType";

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "warehouseType" "WarehouseType" NOT NULL,
    "projectId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "status" "InventoryLocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHandQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "availableQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "signedQuantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceModule" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "reversalOfMovementId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "postedByMemberId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "goodsReceiptId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "status" "InventoryTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "postedByMemberId" TEXT,
    "reversedByMemberId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_receipt_lines" (
    "id" TEXT NOT NULL,
    "inventoryReceiptId" TEXT NOT NULL,
    "goodsReceiptItemId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "movementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issues" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issueNumber" TEXT NOT NULL,
    "projectId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "status" "InventoryTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "issuedToMemberId" TEXT,
    "requestedByMemberId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "postedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_lines" (
    "id" TEXT NOT NULL,
    "stockIssueId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "reservationId" TEXT,
    "movementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_returns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "status" "InventoryTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "returnedByMemberId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "postedByMemberId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_return_lines" (
    "id" TEXT NOT NULL,
    "stockReturnId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceIssueLineId" TEXT,
    "movementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "status" "InventoryTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMemberId" TEXT NOT NULL,
    "postedByMemberId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "outMovementId" TEXT,
    "inMovementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "adjustmentNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "adjustmentDate" TIMESTAMP(3) NOT NULL,
    "reason" "StockAdjustmentReason" NOT NULL,
    "status" "InventoryTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMemberId" TEXT NOT NULL,
    "postedByMemberId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" TEXT NOT NULL,
    "stockAdjustmentId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantityDelta" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "movementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationNumber" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "projectId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "fulfilledQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "requiredDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_companyId_idx" ON "warehouses"("companyId");

-- CreateIndex
CREATE INDEX "warehouses_companyId_status_idx" ON "warehouses"("companyId", "status");

-- CreateIndex
CREATE INDEX "warehouses_warehouseType_idx" ON "warehouses"("warehouseType");

-- CreateIndex
CREATE INDEX "warehouses_projectId_idx" ON "warehouses"("projectId");

-- CreateIndex
CREATE INDEX "warehouses_city_idx" ON "warehouses"("city");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_companyId_code_key" ON "warehouses"("companyId", "code");

-- CreateIndex
CREATE INDEX "inventory_locations_companyId_idx" ON "inventory_locations"("companyId");

-- CreateIndex
CREATE INDEX "inventory_locations_warehouseId_idx" ON "inventory_locations"("warehouseId");

-- CreateIndex
CREATE INDEX "inventory_locations_status_idx" ON "inventory_locations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_warehouseId_code_key" ON "inventory_locations"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "inventory_balances_companyId_idx" ON "inventory_balances"("companyId");

-- CreateIndex
CREATE INDEX "inventory_balances_warehouseId_idx" ON "inventory_balances"("warehouseId");

-- CreateIndex
CREATE INDEX "inventory_balances_inventoryItemId_idx" ON "inventory_balances"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_balances_availableQuantity_idx" ON "inventory_balances"("availableQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_inventoryItemId_locationId_key" ON "inventory_balances"("inventoryItemId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_idx" ON "stock_movements"("companyId");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_occurredAt_idx" ON "stock_movements"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_inventoryItemId_idx" ON "stock_movements"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_movements_warehouseId_idx" ON "stock_movements"("warehouseId");

-- CreateIndex
CREATE INDEX "stock_movements_locationId_idx" ON "stock_movements"("locationId");

-- CreateIndex
CREATE INDEX "stock_movements_projectId_idx" ON "stock_movements"("projectId");

-- CreateIndex
CREATE INDEX "stock_movements_movementType_idx" ON "stock_movements"("movementType");

-- CreateIndex
CREATE INDEX "stock_movements_sourceModule_sourceEntityType_sourceEntityI_idx" ON "stock_movements"("sourceModule", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "stock_movements_sourceLineId_idx" ON "stock_movements"("sourceLineId");

-- CreateIndex
CREATE INDEX "stock_movements_reversalOfMovementId_idx" ON "stock_movements"("reversalOfMovementId");

-- CreateIndex
CREATE INDEX "inventory_receipts_companyId_idx" ON "inventory_receipts"("companyId");

-- CreateIndex
CREATE INDEX "inventory_receipts_companyId_status_idx" ON "inventory_receipts"("companyId", "status");

-- CreateIndex
CREATE INDEX "inventory_receipts_warehouseId_idx" ON "inventory_receipts"("warehouseId");

-- CreateIndex
CREATE INDEX "inventory_receipts_postedAt_idx" ON "inventory_receipts"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_receipts_companyId_receiptNumber_key" ON "inventory_receipts"("companyId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_receipts_goodsReceiptId_key" ON "inventory_receipts"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "inventory_receipt_lines_inventoryReceiptId_idx" ON "inventory_receipt_lines"("inventoryReceiptId");

-- CreateIndex
CREATE INDEX "inventory_receipt_lines_goodsReceiptItemId_idx" ON "inventory_receipt_lines"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "inventory_receipt_lines_inventoryItemId_idx" ON "inventory_receipt_lines"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_receipt_lines_locationId_idx" ON "inventory_receipt_lines"("locationId");

-- CreateIndex
CREATE INDEX "inventory_receipt_lines_movementId_idx" ON "inventory_receipt_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_issues_companyId_idx" ON "stock_issues"("companyId");

-- CreateIndex
CREATE INDEX "stock_issues_companyId_status_idx" ON "stock_issues"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_issues_projectId_idx" ON "stock_issues"("projectId");

-- CreateIndex
CREATE INDEX "stock_issues_warehouseId_idx" ON "stock_issues"("warehouseId");

-- CreateIndex
CREATE INDEX "stock_issues_issueDate_idx" ON "stock_issues"("issueDate");

-- CreateIndex
CREATE INDEX "stock_issues_issuedToMemberId_idx" ON "stock_issues"("issuedToMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_companyId_issueNumber_key" ON "stock_issues"("companyId", "issueNumber");

-- CreateIndex
CREATE INDEX "stock_issue_lines_stockIssueId_idx" ON "stock_issue_lines"("stockIssueId");

-- CreateIndex
CREATE INDEX "stock_issue_lines_inventoryItemId_idx" ON "stock_issue_lines"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_issue_lines_locationId_idx" ON "stock_issue_lines"("locationId");

-- CreateIndex
CREATE INDEX "stock_issue_lines_reservationId_idx" ON "stock_issue_lines"("reservationId");

-- CreateIndex
CREATE INDEX "stock_issue_lines_movementId_idx" ON "stock_issue_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_returns_companyId_idx" ON "stock_returns"("companyId");

-- CreateIndex
CREATE INDEX "stock_returns_companyId_status_idx" ON "stock_returns"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_returns_projectId_idx" ON "stock_returns"("projectId");

-- CreateIndex
CREATE INDEX "stock_returns_warehouseId_idx" ON "stock_returns"("warehouseId");

-- CreateIndex
CREATE INDEX "stock_returns_returnDate_idx" ON "stock_returns"("returnDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_returns_companyId_returnNumber_key" ON "stock_returns"("companyId", "returnNumber");

-- CreateIndex
CREATE INDEX "stock_return_lines_stockReturnId_idx" ON "stock_return_lines"("stockReturnId");

-- CreateIndex
CREATE INDEX "stock_return_lines_inventoryItemId_idx" ON "stock_return_lines"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_return_lines_locationId_idx" ON "stock_return_lines"("locationId");

-- CreateIndex
CREATE INDEX "stock_return_lines_sourceIssueLineId_idx" ON "stock_return_lines"("sourceIssueLineId");

-- CreateIndex
CREATE INDEX "stock_return_lines_movementId_idx" ON "stock_return_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_transfers_companyId_idx" ON "stock_transfers"("companyId");

-- CreateIndex
CREATE INDEX "stock_transfers_companyId_status_idx" ON "stock_transfers"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_fromWarehouseId_idx" ON "stock_transfers"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "stock_transfers_toWarehouseId_idx" ON "stock_transfers"("toWarehouseId");

-- CreateIndex
CREATE INDEX "stock_transfers_transferDate_idx" ON "stock_transfers"("transferDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_companyId_transferNumber_key" ON "stock_transfers"("companyId", "transferNumber");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_stockTransferId_idx" ON "stock_transfer_lines"("stockTransferId");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_inventoryItemId_idx" ON "stock_transfer_lines"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_fromLocationId_idx" ON "stock_transfer_lines"("fromLocationId");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_toLocationId_idx" ON "stock_transfer_lines"("toLocationId");

-- CreateIndex
CREATE INDEX "stock_adjustments_companyId_idx" ON "stock_adjustments"("companyId");

-- CreateIndex
CREATE INDEX "stock_adjustments_companyId_status_idx" ON "stock_adjustments"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_adjustments_warehouseId_idx" ON "stock_adjustments"("warehouseId");

-- CreateIndex
CREATE INDEX "stock_adjustments_adjustmentDate_idx" ON "stock_adjustments"("adjustmentDate");

-- CreateIndex
CREATE INDEX "stock_adjustments_reason_idx" ON "stock_adjustments"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_companyId_adjustmentNumber_key" ON "stock_adjustments"("companyId", "adjustmentNumber");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_stockAdjustmentId_idx" ON "stock_adjustment_lines"("stockAdjustmentId");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_inventoryItemId_idx" ON "stock_adjustment_lines"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_locationId_idx" ON "stock_adjustment_lines"("locationId");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_movementId_idx" ON "stock_adjustment_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_reservations_companyId_idx" ON "stock_reservations"("companyId");

-- CreateIndex
CREATE INDEX "stock_reservations_companyId_status_idx" ON "stock_reservations"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_inventoryItemId_idx" ON "stock_reservations"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_reservations_warehouseId_idx" ON "stock_reservations"("warehouseId");

-- CreateIndex
CREATE INDEX "stock_reservations_locationId_idx" ON "stock_reservations"("locationId");

-- CreateIndex
CREATE INDEX "stock_reservations_projectId_idx" ON "stock_reservations"("projectId");

-- CreateIndex
CREATE INDEX "stock_reservations_requiredDate_idx" ON "stock_reservations"("requiredDate");

-- CreateIndex
CREATE INDEX "stock_reservations_expiresAt_idx" ON "stock_reservations"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_companyId_reservationNumber_key" ON "stock_reservations"("companyId", "reservationNumber");

-- CreateIndex
CREATE INDEX "inventory_items_companyId_status_idx" ON "inventory_items"("companyId", "status");

-- CreateIndex
CREATE INDEX "inventory_items_category_idx" ON "inventory_items"("category");

-- CreateIndex
CREATE INDEX "inventory_items_updatedAt_idx" ON "inventory_items"("updatedAt");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversalOfMovementId_fkey" FOREIGN KEY ("reversalOfMovementId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_inventoryReceiptId_fkey" FOREIGN KEY ("inventoryReceiptId") REFERENCES "inventory_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_stockIssueId_fkey" FOREIGN KEY ("stockIssueId") REFERENCES "stock_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_lines" ADD CONSTRAINT "stock_return_lines_stockReturnId_fkey" FOREIGN KEY ("stockReturnId") REFERENCES "stock_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_lines" ADD CONSTRAINT "stock_return_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_lines" ADD CONSTRAINT "stock_return_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_stockAdjustmentId_fkey" FOREIGN KEY ("stockAdjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

