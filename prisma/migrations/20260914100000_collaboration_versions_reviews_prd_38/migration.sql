-- CreateEnum
CREATE TYPE "DocumentReviewState" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('AUTHOR', 'MENTION', 'STAKEHOLDER', 'MANUAL');

-- AlterTable
ALTER TABLE "document_upload_sessions" ADD COLUMN     "documentVersionId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "latestVersionNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByMemberId" TEXT,
ADD COLUMN     "blockedReason" TEXT;

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageProvider" TEXT,
    "storageBucket" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT,
    "fileName" TEXT,
    "extension" TEXT,
    "mimeTypeDeclared" TEXT,
    "mimeTypeDetected" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "storageStatus" "DocumentStorageStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "scanProvider" TEXT,
    "scanCompletedAt" TIMESTAMP(3),
    "previewStatus" "DocumentPreviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "previewMimeType" TEXT,
    "rejectionReason" TEXT,
    "reviewState" "DocumentReviewState" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "supersededAt" TIMESTAMP(3),
    "uploadedByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "reviewerMemberId" TEXT NOT NULL,
    "status" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "requestNote" TEXT,
    "decisionNote" TEXT,
    "decidedByMemberId" TEXT,
    "pendingKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_threads" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentType" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "lastCommentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mentionedMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_subscriptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "source" "SubscriptionSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storageKey_key" ON "document_versions"("storageKey");

-- CreateIndex
CREATE INDEX "document_versions_companyId_documentId_versionNumber_idx" ON "document_versions"("companyId", "documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "document_versions_storageStatus_scanStatus_idx" ON "document_versions"("storageStatus", "scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "document_reviews_pendingKey_key" ON "document_reviews"("pendingKey");

-- CreateIndex
CREATE INDEX "document_reviews_companyId_reviewerMemberId_status_idx" ON "document_reviews"("companyId", "reviewerMemberId", "status");

-- CreateIndex
CREATE INDEX "document_reviews_documentVersionId_idx" ON "document_reviews"("documentVersionId");

-- CreateIndex
CREATE INDEX "document_reviews_companyId_documentId_idx" ON "document_reviews"("companyId", "documentId");

-- CreateIndex
CREATE INDEX "collaboration_threads_companyId_lastCommentAt_idx" ON "collaboration_threads"("companyId", "lastCommentAt");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_threads_companyId_parentType_parentId_key" ON "collaboration_threads"("companyId", "parentType", "parentId");

-- CreateIndex
CREATE INDEX "comments_companyId_threadId_createdAt_idx" ON "comments"("companyId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_companyId_authorMemberId_createdAt_idx" ON "comments"("companyId", "authorMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "mentions_companyId_mentionedMemberId_createdAt_idx" ON "mentions"("companyId", "mentionedMemberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mentions_commentId_mentionedMemberId_key" ON "mentions"("commentId", "mentionedMemberId");

-- CreateIndex
CREATE INDEX "collaboration_subscriptions_companyId_memberId_active_idx" ON "collaboration_subscriptions"("companyId", "memberId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_subscriptions_threadId_memberId_key" ON "collaboration_subscriptions"("threadId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_currentVersionId_key" ON "documents"("currentVersionId");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "collaboration_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentionedMemberId_fkey" FOREIGN KEY ("mentionedMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_subscriptions" ADD CONSTRAINT "collaboration_subscriptions_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "collaboration_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_subscriptions" ADD CONSTRAINT "collaboration_subscriptions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every document that already has a stored object becomes version 1
-- of itself, and points at it (PRD #38 §56, §57). The version copies the file
-- columns exactly; nothing about the object changes.
INSERT INTO "document_versions" (
    "id", "companyId", "documentId", "versionNumber",
    "storageProvider", "storageBucket", "storageKey", "originalFileName", "fileName", "extension",
    "mimeTypeDeclared", "mimeTypeDetected", "sizeBytes", "checksumSha256",
    "storageStatus", "scanStatus", "scanProvider", "scanCompletedAt", "previewStatus", "previewMimeType",
    "rejectionReason", "reviewState", "uploadedByMemberId", "createdAt", "updatedAt", "availableAt"
)
SELECT
    'dver_' || substr(md5(d."id" || ':1'), 1, 24), d."companyId", d."id", 1,
    d."storageProvider", d."storageBucket", d."storageKey", d."originalFileName", d."fileName", d."extension",
    d."mimeType", d."detectedMimeType", d."sizeBytes", d."checksum",
    d."storageStatus", d."scanStatus", d."scanProvider", d."scanCompletedAt", d."previewStatus", d."previewMimeType",
    d."rejectionReason", 'DRAFT', COALESCE(d."uploadedByMemberId", ''), d."createdAt", d."updatedAt", d."availableAt"
FROM "documents" d
WHERE d."storageKey" IS NOT NULL;

UPDATE "documents" d
SET "currentVersionId" = v."id", "latestVersionNumber" = 1
FROM "document_versions" v
WHERE v."documentId" = d."id" AND v."versionNumber" = 1;

UPDATE "document_upload_sessions" s
SET "documentVersionId" = v."id"
FROM "document_versions" v
WHERE v."documentId" = s."documentId" AND v."versionNumber" = 1 AND s."documentVersionId" IS NULL;
