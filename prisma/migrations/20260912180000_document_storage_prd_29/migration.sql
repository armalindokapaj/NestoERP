-- NESTO V0.1 — File / Document Storage Production Architecture (PRD #29)
--
-- Purely additive. The binary and its metadata are separate concerns
-- (PRD #29 §2), so this migration adds the storage lifecycle alongside the
-- existing business `status` rather than overloading it, plus the upload
-- session, the quota and the usage projection.
--
-- The backfill at the foot is the honest part: rows that already have an
-- object become AVAILABLE, rows that never had one become FAILED. Nothing is
-- promoted to AVAILABLE on the strength of a metadata row alone (PRD #29 §233).

-- CreateEnum
CREATE TYPE "DocumentStorageStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'VERIFYING', 'SCANNING', 'AVAILABLE', 'REJECTED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "DocumentPreviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentUploadSessionStatus" AS ENUM ('CREATED', 'UPLOADING', 'COMPLETED', 'EXPIRED', 'ABORTED', 'FAILED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "detectedMimeType" TEXT,
ADD COLUMN     "previewMimeType" TEXT,
ADD COLUMN     "previewStatus" "DocumentPreviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "previewStorageKey" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "scanCompletedAt" TIMESTAMP(3),
ADD COLUMN     "scanProvider" TEXT,
ADD COLUMN     "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "storageStatus" "DocumentStorageStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
ADD COLUMN     "thumbnailStorageKey" TEXT,
ADD COLUMN     "uploadedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "document_upload_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "expectedFileName" TEXT NOT NULL,
    "expectedMimeType" TEXT,
    "expectedSizeBytes" BIGINT NOT NULL,
    "status" "DocumentUploadSessionStatus" NOT NULL DEFAULT 'CREATED',
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "multipartUploadId" TEXT,
    "idempotencyKey" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_storage_quotas" (
    "companyId" TEXT NOT NULL,
    "maxStorageBytes" BIGINT,
    "maxSingleFileBytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_storage_quotas_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "company_storage_usage" (
    "companyId" TEXT NOT NULL,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_storage_usage_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "document_upload_sessions_companyId_idx" ON "document_upload_sessions"("companyId");

-- CreateIndex
CREATE INDEX "document_upload_sessions_documentId_idx" ON "document_upload_sessions"("documentId");

-- CreateIndex
CREATE INDEX "document_upload_sessions_memberId_idx" ON "document_upload_sessions"("memberId");

-- CreateIndex
CREATE INDEX "document_upload_sessions_status_expiresAt_idx" ON "document_upload_sessions"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_upload_sessions_storageKey_key" ON "document_upload_sessions"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_upload_sessions_companyId_memberId_idempotencyKey_key" ON "document_upload_sessions"("companyId", "memberId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "documents_companyId_storageStatus_idx" ON "documents"("companyId", "storageStatus");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- AddForeignKey
ALTER TABLE "document_upload_sessions" ADD CONSTRAINT "document_upload_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_upload_sessions" ADD CONSTRAINT "document_upload_sessions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_upload_sessions" ADD CONSTRAINT "document_upload_sessions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_storage_quotas" ADD CONSTRAINT "company_storage_quotas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_storage_usage" ADD CONSTRAINT "company_storage_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity constraints (PRD #29 §144, §146, §150)
-- ---------------------------------------------------------------------------

ALTER TABLE "company_storage_quotas"
  ADD CONSTRAINT "company_storage_quotas_single_file_positive" CHECK ("maxSingleFileBytes" > 0),
  ADD CONSTRAINT "company_storage_quotas_total_positive" CHECK ("maxStorageBytes" IS NULL OR "maxStorageBytes" > 0);

ALTER TABLE "company_storage_usage"
  ADD CONSTRAINT "company_storage_usage_not_negative" CHECK ("usedBytes" >= 0 AND "fileCount" >= 0);

ALTER TABLE "document_upload_sessions"
  ADD CONSTRAINT "document_upload_sessions_expected_size_positive" CHECK ("expectedSizeBytes" > 0),
  ADD CONSTRAINT "document_upload_sessions_reserved_not_negative" CHECK ("reservedBytes" >= 0);

-- ---------------------------------------------------------------------------
-- Backfill (PRD #29 §399, §402)
-- ---------------------------------------------------------------------------

-- A document that already has a stored object is available; one that was
-- archived stays archived; one that never had an object is what it has always
-- been — a metadata row whose upload never completed (PRD #29 §128, §132).
UPDATE "documents" SET
  "storageStatus" = CASE
    WHEN "storageKey" IS NULL          THEN 'FAILED'::"DocumentStorageStatus"
    WHEN "status" = 'ARCHIVED'         THEN 'ARCHIVED'::"DocumentStorageStatus"
    ELSE                                    'AVAILABLE'::"DocumentStorageStatus"
  END,
  "uploadedAt"  = CASE WHEN "storageKey" IS NULL THEN NULL ELSE "createdAt" END,
  "verifiedAt"  = CASE WHEN "storageKey" IS NULL THEN NULL ELSE "createdAt" END,
  "availableAt" = CASE WHEN "storageKey" IS NULL THEN NULL ELSE "createdAt" END,
  "rejectedAt"      = CASE WHEN "storageKey" IS NULL THEN "createdAt" ELSE NULL END,
  "rejectionReason" = CASE WHEN "storageKey" IS NULL THEN 'STORAGE_OBJECT_MISSING' ELSE NULL END,
  -- PDFs and images are inline-safe as they stand, so the original is its own
  -- preview and no derived object is owed. Everything else is download-only
  -- (PRD #29 §44, §45, §53).
  "previewStatus" = CASE
    WHEN "storageKey" IS NOT NULL AND lower(coalesce("extension", '')) IN ('pdf','jpg','jpeg','png','webp')
      THEN 'READY'::"DocumentPreviewStatus"
    ELSE 'NOT_REQUIRED'::"DocumentPreviewStatus"
  END,
  "previewMimeType" = CASE
    WHEN "storageKey" IS NOT NULL AND lower(coalesce("extension", '')) IN ('pdf','jpg','jpeg','png','webp')
      THEN "mimeType"
    ELSE NULL
  END;

-- Usage counts the bytes a customer uploaded, not derived objects
-- (PRD #29 §146, §243).
INSERT INTO "company_storage_usage" ("companyId", "usedBytes", "fileCount", "updatedAt")
SELECT
  d."companyId",
  COALESCE(SUM(d."sizeBytes"), 0),
  COUNT(*)::int,
  NOW()
FROM "documents" d
WHERE d."storageKey" IS NOT NULL
  AND d."storageStatus" <> 'REJECTED'
GROUP BY d."companyId"
ON CONFLICT ("companyId") DO NOTHING;

-- Every company gets the product default ceiling: 100 MB per file, no hard
-- total until a deployment sets one (PRD #29 §25, §26, §145).
INSERT INTO "company_storage_quotas" ("companyId", "maxStorageBytes", "maxSingleFileBytes", "createdAt", "updatedAt")
SELECT c."id", NULL, 104857600, NOW(), NOW()
FROM "companies" c
ON CONFLICT ("companyId") DO NOTHING;
