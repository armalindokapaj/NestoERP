-- AlterTable
ALTER TABLE "notification_event_outbox" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "category" TEXT,
ALTER COLUMN "moduleKey" DROP NOT NULL,
ALTER COLUMN "eventGroup" DROP NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "category" TEXT,
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "job" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "lastProcessed" INTEGER NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "instance" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE INDEX "notification_event_outbox_status_leaseExpiresAt_idx" ON "notification_event_outbox"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_companyId_memberId_category_key" ON "notification_preferences"("companyId", "memberId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_companyId_recipientMemberId_dedupeKey_key" ON "notifications"("companyId", "recipientMemberId", "dedupeKey");

