-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationReadState" AS ENUM ('UNREAD', 'READ');

-- CreateEnum
CREATE TYPE "AttentionStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationEventGroup" AS ENUM ('ASSIGNMENTS', 'APPROVALS', 'DEADLINES', 'CRITICAL_ALERTS', 'STATUS_UPDATES', 'REMINDERS');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "readState" "NotificationReadState" NOT NULL DEFAULT 'UNREAD',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "actorMemberId" TEXT,
    "correlationId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attention_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "conditionKey" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AttentionStatus" NOT NULL DEFAULT 'ACTIVE',
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attention_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "eventGroup" "NotificationEventGroup" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event_outbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "projectId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "correlationId" TEXT,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE INDEX "notifications_recipientMemberId_readState_createdAt_idx" ON "notifications"("recipientMemberId", "readState", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientMemberId_createdAt_idx" ON "notifications"("recipientMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_moduleKey_idx" ON "notifications"("moduleKey");

-- CreateIndex
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "notifications_projectId_idx" ON "notifications"("projectId");

-- CreateIndex
CREATE INDEX "notifications_priority_idx" ON "notifications"("priority");

-- CreateIndex
CREATE INDEX "notifications_dedupeKey_idx" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_correlationId_idx" ON "notifications"("correlationId");

-- CreateIndex
CREATE INDEX "attention_items_recipientMemberId_status_priority_idx" ON "attention_items"("recipientMemberId", "status", "priority");

-- CreateIndex
CREATE INDEX "attention_items_recipientMemberId_lastEvaluatedAt_idx" ON "attention_items"("recipientMemberId", "lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "attention_items_moduleKey_idx" ON "attention_items"("moduleKey");

-- CreateIndex
CREATE INDEX "attention_items_entityType_entityId_idx" ON "attention_items"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "attention_items_projectId_idx" ON "attention_items"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "attention_items_companyId_recipientMemberId_dedupeKey_key" ON "attention_items"("companyId", "recipientMemberId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_preferences_memberId_idx" ON "notification_preferences"("memberId");

-- CreateIndex
CREATE INDEX "notification_preferences_companyId_idx" ON "notification_preferences"("companyId");

-- CreateIndex
CREATE INDEX "notification_preferences_moduleKey_idx" ON "notification_preferences"("moduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_companyId_memberId_moduleKey_event_key" ON "notification_preferences"("companyId", "memberId", "moduleKey", "eventGroup");

-- CreateIndex
CREATE INDEX "notification_event_outbox_status_nextAttemptAt_idx" ON "notification_event_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_event_outbox_companyId_idx" ON "notification_event_outbox"("companyId");

-- CreateIndex
CREATE INDEX "notification_event_outbox_eventType_idx" ON "notification_event_outbox"("eventType");

-- CreateIndex
CREATE INDEX "notification_event_outbox_createdAt_idx" ON "notification_event_outbox"("createdAt");

-- CreateIndex
CREATE INDEX "notification_event_outbox_correlationId_idx" ON "notification_event_outbox"("correlationId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event_outbox" ADD CONSTRAINT "notification_event_outbox_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
