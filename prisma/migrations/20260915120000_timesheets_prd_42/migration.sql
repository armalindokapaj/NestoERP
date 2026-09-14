-- PRD #42 Timesheets & Work Logs: timesheets, work logs, approval cycles, settings and
-- designated approvers. Additive only.

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkLogType" AS ENUM ('PROJECT_WORK', 'INTERNAL', 'ADMIN', 'TRAINING', 'TRAVEL', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "TimesheetApprovalRecordType" AS ENUM ('TIMESHEET');

-- CreateEnum
CREATE TYPE "TimesheetApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "approverMemberId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedByMemberId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByMemberId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByMemberId" TEXT,
    "decisionNote" TEXT,
    "submissionVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "workType" "WorkLogType" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "overtimeFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "TimesheetApprovalRecordType" NOT NULL DEFAULT 'TIMESHEET',
    "recordId" TEXT NOT NULL,
    "status" "TimesheetApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submissionVersion" INTEGER NOT NULL,
    "approverMemberId" TEXT NOT NULL,
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "standardDailyMinutes" INTEGER NOT NULL DEFAULT 480,
    "standardWeeklyMinutes" INTEGER NOT NULL DEFAULT 2400,
    "incrementMinutes" INTEGER NOT NULL DEFAULT 15,
    "enforceIncrement" BOOLEAN NOT NULL DEFAULT false,
    "backdateDays" INTEGER NOT NULL DEFAULT 14,
    "submitDay" INTEGER,
    "submitTime" TEXT,
    "descriptionsRequired" BOOLEAN NOT NULL DEFAULT false,
    "membersSetBillable" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_approver_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "approverMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_approver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheets_companyId_memberId_status_idx" ON "timesheets"("companyId", "memberId", "status");

-- CreateIndex
CREATE INDEX "timesheets_companyId_status_periodStart_idx" ON "timesheets"("companyId", "status", "periodStart");

-- CreateIndex
CREATE INDEX "timesheets_companyId_approverMemberId_status_idx" ON "timesheets"("companyId", "approverMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_companyId_memberId_periodStart_key" ON "timesheets"("companyId", "memberId", "periodStart");

-- CreateIndex
CREATE INDEX "work_logs_companyId_memberId_workDate_idx" ON "work_logs"("companyId", "memberId", "workDate");

-- CreateIndex
CREATE INDEX "work_logs_companyId_projectId_workDate_idx" ON "work_logs"("companyId", "projectId", "workDate");

-- CreateIndex
CREATE INDEX "work_logs_companyId_taskId_workDate_idx" ON "work_logs"("companyId", "taskId", "workDate");

-- CreateIndex
CREATE INDEX "work_logs_timesheetId_workDate_idx" ON "work_logs"("timesheetId", "workDate");

-- CreateIndex
CREATE INDEX "timesheet_approvals_companyId_status_idx" ON "timesheet_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "timesheet_approvals_recordType_recordId_idx" ON "timesheet_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "timesheet_approvals_submittedByMemberId_idx" ON "timesheet_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "timesheet_approvals_decidedByMemberId_idx" ON "timesheet_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "timesheet_approvals_submittedAt_idx" ON "timesheet_approvals"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_settings_companyId_key" ON "timesheet_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_approver_assignments_memberId_key" ON "timesheet_approver_assignments"("memberId");

-- CreateIndex
CREATE INDEX "timesheet_approver_assignments_companyId_approverMemberId_idx" ON "timesheet_approver_assignments"("companyId", "approverMemberId");

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_approvals" ADD CONSTRAINT "timesheet_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_settings" ADD CONSTRAINT "timesheet_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_approver_assignments" ADD CONSTRAINT "timesheet_approver_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_approver_assignments" ADD CONSTRAINT "timesheet_approver_assignments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "company_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_approver_assignments" ADD CONSTRAINT "timesheet_approver_assignments_approverMemberId_fkey" FOREIGN KEY ("approverMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

