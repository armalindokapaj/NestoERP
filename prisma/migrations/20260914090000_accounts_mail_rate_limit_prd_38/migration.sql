-- CreateEnum
CREATE TYPE "MailDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'LOGIN_RATE_LIMITED';
ALTER TYPE "AuthEventType" ADD VALUE 'PASSWORD_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'SESSIONS_REVOKED';

-- CreateTable
CREATE TABLE "mail_deliveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "recipient" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "MailDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "mail_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_deliveries_idempotencyKey_key" ON "mail_deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "mail_deliveries_status_createdAt_idx" ON "mail_deliveries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "mail_deliveries_companyId_createdAt_idx" ON "mail_deliveries"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "mail_deliveries_entityType_entityId_idx" ON "mail_deliveries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_windowEndsAt_idx" ON "rate_limit_buckets"("windowEndsAt");

