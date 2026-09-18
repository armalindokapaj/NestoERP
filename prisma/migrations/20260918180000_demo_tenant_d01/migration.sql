-- D-01 Demo tenant: a group's registration number (NIPT) and city, a demo flag, company
-- ownership, a project's published built area and key-project flag, and the
-- provenance of a demo seed's records (ADR 0005).
--
-- Additive only: nullable columns, false defaults and two new tables. No data
-- is changed. Rollback: docs/release-readiness.md §27.

-- CreateEnum
CREATE TYPE "DemoSourceType" AS ENUM ('PUBLIC', 'SYNTHETIC', 'INFERRED');

-- AlterTable
ALTER TABLE "parent_groups" ADD COLUMN     "city" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationNumber" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "builtArea" DECIMAL(12,2),
ADD COLUMN     "isKeyProject" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "company_owners" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "holderParentGroupId" TEXT,
    "holderName" TEXT NOT NULL,
    "holderTaxNumber" TEXT,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "since" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_records" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceType" "DemoSourceType" NOT NULL,
    "fieldSources" JSONB,
    "sourceLabel" TEXT,
    "sourceUrl" TEXT,
    "sourceVerifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_owners_companyId_idx" ON "company_owners"("companyId");

-- CreateIndex
CREATE INDEX "company_owners_holderParentGroupId_idx" ON "company_owners"("holderParentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "demo_records_key_key" ON "demo_records"("key");

-- CreateIndex
CREATE INDEX "demo_records_parentGroupId_sourceType_idx" ON "demo_records"("parentGroupId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "demo_records_entityType_entityId_key" ON "demo_records"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "company_owners" ADD CONSTRAINT "company_owners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_owners" ADD CONSTRAINT "company_owners_holderParentGroupId_fkey" FOREIGN KEY ("holderParentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A share is a percentage above nothing and at most the whole company.
ALTER TABLE "company_owners" ADD CONSTRAINT "company_owners_share_check" CHECK ("sharePercent" > 0 AND "sharePercent" <= 100);
