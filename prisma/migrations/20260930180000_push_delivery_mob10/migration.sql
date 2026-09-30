-- CreateEnum
CREATE TYPE "PushDeliveryState" AS ENUM ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED', 'FAILED', 'TOKEN_INVALID', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "NotificationProjectLevel" AS ENUM ('ALL', 'IMPORTANT', 'MUTED');

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "threadKey" TEXT;

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceRegistrationId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "state" "PushDeliveryState" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "providerMessageId" TEXT,
    "settledAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_quiet_hours" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER NOT NULL DEFAULT 1320,
    "endMinute" INTEGER NOT NULL DEFAULT 420,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "allowCritical" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_quiet_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_project_preferences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "level" "NotificationProjectLevel" NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_project_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_deliveries_state_sendAfter_idx" ON "push_deliveries"("state", "sendAfter");

-- CreateIndex
CREATE INDEX "push_deliveries_userId_state_idx" ON "push_deliveries"("userId", "state");

-- CreateIndex
CREATE INDEX "push_deliveries_companyId_createdAt_idx" ON "push_deliveries"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_notificationId_deviceRegistrationId_key" ON "push_deliveries"("notificationId", "deviceRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_quiet_hours_userId_key" ON "notification_quiet_hours"("userId");

-- CreateIndex
CREATE INDEX "notification_project_preferences_memberId_idx" ON "notification_project_preferences"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_project_preferences_companyId_memberId_project_key" ON "notification_project_preferences"("companyId", "memberId", "projectId");

-- CreateIndex
CREATE INDEX "notifications_recipientMemberId_archivedAt_createdAt_idx" ON "notifications"("recipientMemberId", "archivedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_deviceRegistrationId_fkey" FOREIGN KEY ("deviceRegistrationId") REFERENCES "device_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

