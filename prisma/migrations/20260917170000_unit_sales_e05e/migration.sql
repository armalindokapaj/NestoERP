-- E-05E: Sales on the canonical unit — its commercial status, asking price and
-- price history, reservations and their extensions, the units in a CRM deal
-- (Opportunity), the commercial status trail, and how long a reservation lasts.
--
-- Purely additive. No unit gets a commercial profile here: a unit without one is
-- Not For Sale (E-05E §58), so nothing is put on sale by a migration.
--
-- Composite foreign keys hold every Sales row to its unit's project and company:
--   (unitId, projectId, companyId) → project_units (id, projectId, companyId)

-- CreateEnum
CREATE TYPE "UnitCommercialStatus" AS ENUM ('NOT_FOR_SALE', 'FOR_SALE', 'ON_HOLD', 'RESERVED', 'SOLD');

-- CreateEnum
CREATE TYPE "UnitPriceBasis" AS ENUM ('SALEABLE_AREA', 'INTERNAL_AREA', 'GROSS_AREA', 'FIXED_UNIT_PRICE');

-- CreateEnum
CREATE TYPE "UnitReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'CANCELLED', 'CONVERTED_TO_SALE');

-- CreateEnum
CREATE TYPE "UnitCommercialChangeSource" AS ENUM ('USER', 'SYSTEM_EXPIRY', 'LEGAL', 'FINANCE', 'IMPORT');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "unitReservationDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "unit_commercial_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "UnitCommercialStatus" NOT NULL DEFAULT 'NOT_FOR_SALE',
    "askingPrice" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "priceBasis" "UnitPriceBasis" NOT NULL DEFAULT 'SALEABLE_AREA',
    "holdReason" TEXT,
    "holdUntil" TIMESTAMP(3),
    "heldByMemberId" TEXT,
    "salesNotes" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_commercial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_price_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "oldPrice" DECIMAL(18,2),
    "newPrice" DECIMAL(18,2),
    "oldCurrency" VARCHAR(3),
    "currency" VARCHAR(3),
    "oldPriceBasis" "UnitPriceBasis",
    "priceBasis" "UnitPriceBasis" NOT NULL,
    "reason" TEXT,
    "changedByMemberId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_reservations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" "UnitReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "expiryWarnedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "closeReason" TEXT,
    "agreedPrice" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_reservation_extensions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "oldExpiresAt" TIMESTAMP(3) NOT NULL,
    "newExpiresAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "extendedByMemberId" TEXT NOT NULL,
    "extendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_reservation_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "agreedPrice" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_commercial_status_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "fromStatus" "UnitCommercialStatus",
    "toStatus" "UnitCommercialStatus" NOT NULL,
    "reason" TEXT,
    "source" "UnitCommercialChangeSource" NOT NULL DEFAULT 'USER',
    "actorMemberId" TEXT,
    "reservationId" TEXT,
    "opportunityId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_commercial_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_commercial_profiles_unitId_key" ON "unit_commercial_profiles"("unitId");

-- CreateIndex
CREATE INDEX "unit_commercial_profiles_companyId_projectId_status_idx" ON "unit_commercial_profiles"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "unit_commercial_profiles_projectId_askingPrice_idx" ON "unit_commercial_profiles"("projectId", "askingPrice");

-- CreateIndex
CREATE UNIQUE INDEX "unit_commercial_profiles_unitId_projectId_companyId_key" ON "unit_commercial_profiles"("unitId", "projectId", "companyId");

-- CreateIndex
CREATE INDEX "unit_price_history_unitId_changedAt_idx" ON "unit_price_history"("unitId", "changedAt");

-- CreateIndex
CREATE INDEX "unit_reservations_unitId_status_idx" ON "unit_reservations"("unitId", "status");

-- CreateIndex
CREATE INDEX "unit_reservations_clientId_idx" ON "unit_reservations"("clientId");

-- CreateIndex
CREATE INDEX "unit_reservations_opportunityId_idx" ON "unit_reservations"("opportunityId");

-- CreateIndex
CREATE INDEX "unit_reservations_status_expiresAt_idx" ON "unit_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "unit_reservations_companyId_projectId_status_idx" ON "unit_reservations"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "unit_reservation_extensions_reservationId_extendedAt_idx" ON "unit_reservation_extensions"("reservationId", "extendedAt");

-- CreateIndex
CREATE INDEX "opportunity_units_unitId_idx" ON "opportunity_units"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_units_opportunityId_unitId_key" ON "opportunity_units"("opportunityId", "unitId");

-- CreateIndex
CREATE INDEX "unit_commercial_status_history_unitId_changedAt_idx" ON "unit_commercial_status_history"("unitId", "changedAt");

-- AddForeignKey
ALTER TABLE "unit_commercial_profiles" ADD CONSTRAINT "unit_commercial_profiles_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_reservations" ADD CONSTRAINT "unit_reservations_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_reservations" ADD CONSTRAINT "unit_reservations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_reservations" ADD CONSTRAINT "unit_reservations_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_reservation_extensions" ADD CONSTRAINT "unit_reservation_extensions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "unit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_units" ADD CONSTRAINT "opportunity_units_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_units" ADD CONSTRAINT "opportunity_units_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_commercial_status_history" ADD CONSTRAINT "unit_commercial_status_history_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One ACTIVE reservation per unit (E-05E §21, §50): two people reserving the same
-- unit at once leave one reservation and one refusal. Prisma cannot express a
-- partial index, so it is written here.
CREATE UNIQUE INDEX "unit_reservations_one_active_per_unit" ON "unit_reservations"("unitId") WHERE "status" = 'ACTIVE';

-- Money is never negative (E-05E §47), a reservation ends after it begins, and a
-- company's reservation length is a sensible number of days (§24).
ALTER TABLE "unit_commercial_profiles" ADD CONSTRAINT "unit_commercial_profiles_asking_price_non_negative" CHECK ("askingPrice" IS NULL OR "askingPrice" >= 0);
ALTER TABLE "unit_reservations" ADD CONSTRAINT "unit_reservations_agreed_price_non_negative" CHECK ("agreedPrice" IS NULL OR "agreedPrice" >= 0);
ALTER TABLE "unit_reservations" ADD CONSTRAINT "unit_reservations_expires_after_reserved" CHECK ("expiresAt" > "reservedAt");
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_unit_reservation_days_range" CHECK ("unitReservationDays" BETWEEN 1 AND 90);
