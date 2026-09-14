-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('INTERNAL', 'PROJECT', 'SITE', 'CLIENT', 'COORDINATION', 'MANAGEMENT', 'DESIGN_REVIEW', 'TECHNICAL', 'PROCUREMENT', 'QA_QC', 'HSE', 'FINANCE', 'LEGAL', 'HR', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MinutesStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "MeetingLocationType" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "MeetingVisibility" AS ENUM ('PARTICIPANTS', 'PROJECT', 'DEPARTMENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "MeetingParticipantRole" AS ENUM ('ORGANIZER', 'CHAIR', 'SECRETARY', 'ATTENDEE', 'OBSERVER');

-- CreateEnum
CREATE TYPE "MeetingResponseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "MeetingAttendanceStatus" AS ENUM ('UNKNOWN', 'PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "MeetingAgendaItemStatus" AS ENUM ('PENDING', 'DISCUSSED', 'SKIPPED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "MeetingActionItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "calendar_reminders" ADD COLUMN     "meetingId" TEXT,
ALTER COLUMN "eventId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "meeting_series" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetingType" "MeetingType" NOT NULL,
    "projectId" TEXT,
    "departmentId" TEXT,
    "visibility" "MeetingVisibility" NOT NULL,
    "locationType" "MeetingLocationType" NOT NULL DEFAULT 'UNSPECIFIED',
    "locationText" TEXT,
    "onlineUrl" TEXT,
    "firstStartsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "recurrenceRule" TEXT NOT NULL,
    "recurrenceEndsAt" TIMESTAMP(3),
    "generatedUntil" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "departmentId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "organizerMemberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetingType" "MeetingType" NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "locationType" "MeetingLocationType" NOT NULL DEFAULT 'UNSPECIFIED',
    "locationText" TEXT,
    "onlineUrl" TEXT,
    "visibility" "MeetingVisibility" NOT NULL,
    "seriesId" TEXT,
    "occurrenceIndex" INTEGER,
    "minutesStatus" "MinutesStatus" NOT NULL DEFAULT 'DRAFT',
    "minutesFinalizedAt" TIMESTAMP(3),
    "minutesFinalizedByMemberId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByMemberId" TEXT,
    "cancelReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "meetingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "MeetingParticipantRole" NOT NULL DEFAULT 'ATTENDEE',
    "response" "MeetingResponseStatus" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "attendance" "MeetingAttendanceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "displayName" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("meetingId","memberId")
);

-- CreateTable
CREATE TABLE "meeting_agenda_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "presenterMemberId" TEXT,
    "plannedMinutes" INTEGER,
    "status" "MeetingAgendaItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_minutes_sections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_minutes_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_decisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "decisionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "recordedByMemberId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_action_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerMemberId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "MeetingActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "linkedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_series_companyId_idx" ON "meeting_series"("companyId");

-- CreateIndex
CREATE INDEX "meeting_series_cancelledAt_generatedUntil_idx" ON "meeting_series"("cancelledAt", "generatedUntil");

-- CreateIndex
CREATE INDEX "meetings_companyId_startsAt_idx" ON "meetings"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_companyId_projectId_startsAt_idx" ON "meetings"("companyId", "projectId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_companyId_status_startsAt_idx" ON "meetings"("companyId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_companyId_departmentId_startsAt_idx" ON "meetings"("companyId", "departmentId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_companyId_organizerMemberId_startsAt_idx" ON "meetings"("companyId", "organizerMemberId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_companyId_archivedAt_idx" ON "meetings"("companyId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_seriesId_occurrenceIndex_key" ON "meetings"("seriesId", "occurrenceIndex");

-- CreateIndex
CREATE INDEX "meeting_participants_memberId_response_idx" ON "meeting_participants"("memberId", "response");

-- CreateIndex
CREATE INDEX "meeting_participants_companyId_memberId_idx" ON "meeting_participants"("companyId", "memberId");

-- CreateIndex
CREATE INDEX "meeting_agenda_items_companyId_meetingId_sortOrder_idx" ON "meeting_agenda_items"("companyId", "meetingId", "sortOrder");

-- CreateIndex
CREATE INDEX "meeting_minutes_sections_companyId_meetingId_sortOrder_idx" ON "meeting_minutes_sections"("companyId", "meetingId", "sortOrder");

-- CreateIndex
CREATE INDEX "meeting_decisions_companyId_meetingId_idx" ON "meeting_decisions"("companyId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_decisions_meetingId_decisionNumber_key" ON "meeting_decisions"("meetingId", "decisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_action_items_linkedTaskId_key" ON "meeting_action_items"("linkedTaskId");

-- CreateIndex
CREATE INDEX "meeting_action_items_companyId_meetingId_status_idx" ON "meeting_action_items"("companyId", "meetingId", "status");

-- CreateIndex
CREATE INDEX "meeting_action_items_companyId_ownerMemberId_status_idx" ON "meeting_action_items"("companyId", "ownerMemberId", "status");

-- CreateIndex
CREATE INDEX "meeting_action_items_companyId_dueAt_status_idx" ON "meeting_action_items"("companyId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "calendar_reminders_companyId_meetingId_idx" ON "calendar_reminders"("companyId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminders_meetingId_memberId_minutesBefore_channel_key" ON "calendar_reminders"("meetingId", "memberId", "minutesBefore", "channel");

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizerMemberId_fkey" FOREIGN KEY ("organizerMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "meeting_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_presenterMemberId_fkey" FOREIGN KEY ("presenterMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minutes_sections" ADD CONSTRAINT "meeting_minutes_sections_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minutes_sections" ADD CONSTRAINT "meeting_minutes_sections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_linkedTaskId_fkey" FOREIGN KEY ("linkedTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

