-- E-05D: the unit page and its publishing — publication state on the canonical
-- unit, immutable published versions, the unit's media and document references,
-- and the publishing requests the Approvals Center reads.
--
-- Purely additive. Every existing unit starts DRAFT with no unpublished changes
-- (E-05D §105): nothing is published by a migration. No unit held a Sales Plan
-- or media before, so there is nothing to map (§106).
--
-- Composite foreign keys hold the derived ownership columns in the database:
--   publication / media / document link (unitId, projectId, companyId)
--                                     → unit (id, projectId, companyId)
--   unit (currentPublicationId, id)   → publication (id, unitId)
-- so a unit's current version is always one of its own, and a reference can
-- never claim another project's or company's unit.

-- CreateEnum
CREATE TYPE "UnitPublicationStatus" AS ENUM ('DRAFT', 'READY_FOR_PUBLISHING', 'PUBLISHED', 'REVISION_REQUIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UnitMediaCategory" AS ENUM ('COVER', 'FLOOR_PLAN_IMAGE', 'INTERIOR_RENDER', 'EXTERIOR_RENDER', 'VIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitDocumentCategory" AS ENUM ('SALES_PLAN', 'TECHNICAL_DRAWING', 'SPECIFICATION', 'CONTRACT', 'FINANCE', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitApprovalRecordType" AS ENUM ('UNIT');

-- CreateEnum
CREATE TYPE "UnitApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED');

-- AlterTable
ALTER TABLE "project_units" ADD COLUMN     "currentPublicationId" TEXT,
ADD COLUMN     "hasUnpublishedChanges" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preArchivePublicationStatus" "UnitPublicationStatus",
ADD COLUMN     "publicationStatus" "UnitPublicationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "publicationStatusChangedAt" TIMESTAMP(3),
ADD COLUMN     "revisionReason" TEXT,
ADD COLUMN     "salesPlanDocumentId" TEXT;

-- CreateTable
CREATE TABLE "unit_publications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByMemberId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "salesPlanDocumentId" TEXT,
    "salesPlanDocumentVersionId" TEXT,
    "primaryMediaDocumentId" TEXT,
    "primaryMediaDocumentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_media" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "category" "UnitMediaCategory" NOT NULL,
    "caption" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_document_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "category" "UnitDocumentCategory" NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_publication_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordType" "UnitApprovalRecordType" NOT NULL DEFAULT 'UNIT',
    "recordId" TEXT NOT NULL,
    "status" "UnitApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_publication_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_publications_unitId_publishedAt_idx" ON "unit_publications"("unitId", "publishedAt");

-- CreateIndex
CREATE INDEX "unit_publications_companyId_projectId_idx" ON "unit_publications"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_publications_unitId_versionNumber_key" ON "unit_publications"("unitId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "unit_publications_id_unitId_key" ON "unit_publications"("id", "unitId");

-- CreateIndex
CREATE INDEX "unit_media_unitId_sortOrder_idx" ON "unit_media"("unitId", "sortOrder");

-- CreateIndex
CREATE INDEX "unit_media_documentId_idx" ON "unit_media"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_media_unitId_documentId_key" ON "unit_media"("unitId", "documentId");

-- CreateIndex
CREATE INDEX "unit_document_links_unitId_category_idx" ON "unit_document_links"("unitId", "category");

-- CreateIndex
CREATE INDEX "unit_document_links_documentId_idx" ON "unit_document_links"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_document_links_unitId_documentId_key" ON "unit_document_links"("unitId", "documentId");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_companyId_idx" ON "unit_publication_approvals"("companyId");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_companyId_status_idx" ON "unit_publication_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_recordType_recordId_idx" ON "unit_publication_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_submittedByMemberId_idx" ON "unit_publication_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_decidedByMemberId_idx" ON "unit_publication_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "unit_publication_approvals_submittedAt_idx" ON "unit_publication_approvals"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_units_currentPublicationId_key" ON "project_units"("currentPublicationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_units_salesPlanDocumentId_key" ON "project_units"("salesPlanDocumentId");

-- CreateIndex
CREATE INDEX "project_units_projectId_publicationStatus_idx" ON "project_units"("projectId", "publicationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "project_units_id_projectId_companyId_key" ON "project_units"("id", "projectId", "companyId");

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_currentPublicationId_id_fkey" FOREIGN KEY ("currentPublicationId", "id") REFERENCES "unit_publications"("id", "unitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_salesPlanDocumentId_fkey" FOREIGN KEY ("salesPlanDocumentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_publications" ADD CONSTRAINT "unit_publications_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_media" ADD CONSTRAINT "unit_media_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_media" ADD CONSTRAINT "unit_media_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_document_links" ADD CONSTRAINT "unit_document_links_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_document_links" ADD CONSTRAINT "unit_document_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_publication_approvals" ADD CONSTRAINT "unit_publication_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one primary image per unit (E-05D §42, §76). Prisma cannot express a
-- partial index, so it is written here; the service clears the old primary
-- before setting the new one inside one transaction, and this index is the last
-- word when two people choose a primary at once.
CREATE UNIQUE INDEX "unit_media_one_primary_per_unit" ON "unit_media"("unitId") WHERE "isPrimary";

-- At most one open publishing request per unit: two people submitting the same
-- unit at once leave one request, not two (E-05D §82).
CREATE UNIQUE INDEX "unit_publication_approvals_one_pending_per_unit" ON "unit_publication_approvals"("recordId") WHERE "status" = 'PENDING';

-- Version numbers start at 1 (E-05D §25).
ALTER TABLE "unit_publications" ADD CONSTRAINT "unit_publications_version_positive" CHECK ("versionNumber" >= 1);
