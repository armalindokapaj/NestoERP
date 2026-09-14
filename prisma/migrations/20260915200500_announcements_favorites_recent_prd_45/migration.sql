-- PRD #45: announcements with audiences, reads, acknowledgments and targets; favorites; recent work; productivity settings. Additive only.

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AnnouncementAudienceType" AS ENUM ('COMPANY', 'DEPARTMENT', 'PROJECT', 'SELECTED_MEMBERS');


-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "audienceType" "AnnouncementAudienceType" NOT NULL DEFAULT 'COMPANY',
    "departmentId" TEXT,
    "projectId" TEXT,
    "authorMemberId" TEXT NOT NULL,
    "publishedByMemberId" TEXT,
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "eventStartsAt" TIMESTAMP(3),
    "eventEndsAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_audience_members" (
    "announcementId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "announcement_audience_members_pkey" PRIMARY KEY ("announcementId","memberId")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "announcementId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "firstReadAt" TIMESTAMP(3) NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcementId","memberId")
);

-- CreateTable
CREATE TABLE "announcement_acknowledgments" (
    "announcementId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_acknowledgments_pkey" PRIMARY KEY ("announcementId","memberId")
);

-- CreateTable
CREATE TABLE "announcement_targets" (
    "announcementId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "targetedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_targets_pkey" PRIMARY KEY ("announcementId","memberId")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recent_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL,
    "accessCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recent_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productivity_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "announcementsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "favoritesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recentWorkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recentWorkRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "announcementAckReminderDays" INTEGER NOT NULL DEFAULT 3,
    "notifyNormalAnnouncements" BOOLEAN NOT NULL DEFAULT false,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productivity_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_companyId_status_publishAt_idx" ON "announcements"("companyId", "status", "publishAt");

-- CreateIndex
CREATE INDEX "announcements_companyId_priority_publishedAt_idx" ON "announcements"("companyId", "priority", "publishedAt");

-- CreateIndex
CREATE INDEX "announcements_companyId_projectId_status_idx" ON "announcements"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "announcements_companyId_departmentId_status_idx" ON "announcements"("companyId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "announcements_companyId_status_expiresAt_idx" ON "announcements"("companyId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "announcements_companyId_eventStartsAt_idx" ON "announcements"("companyId", "eventStartsAt");

-- CreateIndex
CREATE INDEX "announcement_audience_members_memberId_idx" ON "announcement_audience_members"("memberId");

-- CreateIndex
CREATE INDEX "announcement_reads_memberId_lastReadAt_idx" ON "announcement_reads"("memberId", "lastReadAt");

-- CreateIndex
CREATE INDEX "announcement_acknowledgments_memberId_acknowledgedAt_idx" ON "announcement_acknowledgments"("memberId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "announcement_targets_memberId_idx" ON "announcement_targets"("memberId");

-- CreateIndex
CREATE INDEX "user_favorites_companyId_memberId_createdAt_idx" ON "user_favorites"("companyId", "memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorites_memberId_entityType_entityId_key" ON "user_favorites"("memberId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "recent_items_companyId_memberId_lastAccessedAt_idx" ON "recent_items"("companyId", "memberId", "lastAccessedAt");

-- CreateIndex
CREATE INDEX "recent_items_lastAccessedAt_idx" ON "recent_items"("lastAccessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recent_items_memberId_entityType_entityId_key" ON "recent_items"("memberId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "productivity_settings_companyId_key" ON "productivity_settings"("companyId");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_audience_members" ADD CONSTRAINT "announcement_audience_members_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_targets" ADD CONSTRAINT "announcement_targets_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_items" ADD CONSTRAINT "recent_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productivity_settings" ADD CONSTRAINT "productivity_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

