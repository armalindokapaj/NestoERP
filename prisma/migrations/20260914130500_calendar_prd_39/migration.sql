-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('COMPANY_EVENT', 'COMPANY_HOLIDAY', 'OFFICE_CLOSURE', 'TRAINING', 'INTERNAL_DEADLINE', 'PERSONAL_EVENT', 'TEAM_EVENT');

-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'SELECTED_MEMBERS', 'PROJECT', 'DEPARTMENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "CalendarParticipantStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "CalendarReminderChannel" AS ENUM ('IN_APP', 'EMAIL');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "defaultCalendarView" TEXT NOT NULL DEFAULT 'week',
ADD COLUMN     "workingDayEnd" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "workingDayStart" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "eventType" "CalendarEventType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "projectId" TEXT,
    "departmentId" TEXT,
    "visibility" "CalendarVisibility" NOT NULL,
    "recurrenceRule" TEXT,
    "recurrenceEndsAt" TIMESTAMP(3),
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_participants" (
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CalendarParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "respondedAt" TIMESTAMP(3),
    "addedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("eventId","memberId")
);

-- CreateTable
CREATE TABLE "calendar_reminders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "channel" "CalendarReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_reminder_deliveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "occurrenceStartsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_companyId_startsAt_idx" ON "calendar_events"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_projectId_startsAt_idx" ON "calendar_events"("companyId", "projectId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_departmentId_startsAt_idx" ON "calendar_events"("companyId", "departmentId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_visibility_startsAt_idx" ON "calendar_events"("companyId", "visibility", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_createdByMemberId_startsAt_idx" ON "calendar_events"("companyId", "createdByMemberId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_archivedAt_idx" ON "calendar_events"("companyId", "archivedAt");

-- CreateIndex
CREATE INDEX "calendar_events_companyId_recurrenceEndsAt_idx" ON "calendar_events"("companyId", "recurrenceEndsAt");

-- CreateIndex
CREATE INDEX "calendar_event_participants_companyId_memberId_idx" ON "calendar_event_participants"("companyId", "memberId");

-- CreateIndex
CREATE INDEX "calendar_event_participants_memberId_idx" ON "calendar_event_participants"("memberId");

-- CreateIndex
CREATE INDEX "calendar_reminders_companyId_eventId_idx" ON "calendar_reminders"("companyId", "eventId");

-- CreateIndex
CREATE INDEX "calendar_reminders_memberId_idx" ON "calendar_reminders"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminders_eventId_memberId_minutesBefore_channel_key" ON "calendar_reminders"("eventId", "memberId", "minutesBefore", "channel");

-- CreateIndex
CREATE INDEX "calendar_reminder_deliveries_companyId_sentAt_idx" ON "calendar_reminder_deliveries"("companyId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_reminder_deliveries_reminderId_occurrenceStartsAt_key" ON "calendar_reminder_deliveries"("reminderId", "occurrenceStartsAt");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminder_deliveries" ADD CONSTRAINT "calendar_reminder_deliveries_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "calendar_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_reminder_deliveries" ADD CONSTRAINT "calendar_reminder_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

