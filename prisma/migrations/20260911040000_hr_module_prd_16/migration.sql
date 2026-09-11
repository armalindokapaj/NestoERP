-- HR module (PRD #16).
--
-- The V0.1 `leave_requests` table was a module test record from PRD #8: a free
-- text type, a whole-day integer, and no employment record behind it. The real
-- leave request belongs to an `EmployeeProfile`, carries fractional days, and
-- draws down a `LeaveBalance`.
--
-- The old rows have no profile to point at and no balance to draw from, so
-- they are removed and the seed rebuilds them in the new shape — rather than
-- inventing an employment record per row and pretending it was always there.
DELETE FROM "activities" WHERE "entityType" = 'LeaveRequest';
DELETE FROM "leave_requests";

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'TEMPORARY', 'OTHER');

-- CreateEnum
CREATE TYPE "HrProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "CompensationPayType" AS ENUM ('SALARY', 'HOURLY', 'DAILY', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'PARENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'ON_LEAVE', 'REMOTE', 'HOLIDAY', 'OFF');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'SELF', 'IMPORT', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_employeeMemberId_fkey";

-- DropIndex
DROP INDEX "leave_requests_employeeMemberId_idx";

-- AlterTable
ALTER TABLE "leave_requests" DROP COLUMN "approvedBy",
DROP COLUMN "createdBy",
DROP COLUMN "employeeMemberId",
DROP COLUMN "type",
DROP COLUMN "updatedBy",
ADD COLUMN     "approvedByMemberId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByMemberId" TEXT,
ADD COLUMN     "companyMemberId" TEXT NOT NULL,
ADD COLUMN     "createdByMemberId" TEXT NOT NULL,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "employeeProfileId" TEXT NOT NULL,
ADD COLUMN     "leaveType" "LeaveType" NOT NULL,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByMemberId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ALTER COLUMN "days" SET DATA TYPE DECIMAL(6,2),
DROP COLUMN "status",
ADD COLUMN     "status" "LeaveRequestStatus" NOT NULL DEFAULT 'DRAFT';

-- DropEnum
DROP TYPE "LeaveStatus";

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyMemberId" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'PLANNED',
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "startDate" TIMESTAMP(3),
    "probationEndDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "managerMemberId" TEXT,
    "workLocation" TEXT,
    "weeklyHours" DECIMAL(6,2),
    "onboardingStatus" "HrProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "offboardingStatus" "HrProgressStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "createdByMemberId" TEXT,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "payType" "CompensationPayType" NOT NULL,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compensations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "companyMemberId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "year" INTEGER NOT NULL,
    "entitledDays" DECIMAL(6,2) NOT NULL,
    "usedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "adjustmentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "companyMemberId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "notes" TEXT,
    "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_companyMemberId_key" ON "employee_profiles"("companyMemberId");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_idx" ON "employee_profiles"("companyId");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_employmentStatus_idx" ON "employee_profiles"("companyId", "employmentStatus");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_employmentType_idx" ON "employee_profiles"("companyId", "employmentType");

-- CreateIndex
CREATE INDEX "employee_profiles_managerMemberId_idx" ON "employee_profiles"("managerMemberId");

-- CreateIndex
CREATE INDEX "employee_profiles_startDate_idx" ON "employee_profiles"("startDate");

-- CreateIndex
CREATE INDEX "employee_profiles_endDate_idx" ON "employee_profiles"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_companyId_employeeNumber_key" ON "employee_profiles"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "compensations_companyId_idx" ON "compensations"("companyId");

-- CreateIndex
CREATE INDEX "compensations_employeeProfileId_idx" ON "compensations"("employeeProfileId");

-- CreateIndex
CREATE INDEX "compensations_employeeProfileId_effectiveFrom_idx" ON "compensations"("employeeProfileId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "compensations_currency_idx" ON "compensations"("currency");

-- CreateIndex
CREATE INDEX "leave_balances_companyId_idx" ON "leave_balances"("companyId");

-- CreateIndex
CREATE INDEX "leave_balances_companyMemberId_idx" ON "leave_balances"("companyMemberId");

-- CreateIndex
CREATE INDEX "leave_balances_year_idx" ON "leave_balances"("year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeProfileId_leaveType_year_key" ON "leave_balances"("employeeProfileId", "leaveType", "year");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_idx" ON "attendance_records"("companyId");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_date_idx" ON "attendance_records"("companyId", "date");

-- CreateIndex
CREATE INDEX "attendance_records_companyMemberId_idx" ON "attendance_records"("companyMemberId");

-- CreateIndex
CREATE INDEX "attendance_records_employeeProfileId_idx" ON "attendance_records"("employeeProfileId");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance_records"("status");

-- CreateIndex
CREATE INDEX "attendance_records_sourceEntityType_sourceEntityId_idx" ON "attendance_records"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_companyMemberId_date_key" ON "attendance_records"("companyMemberId", "date");

-- CreateIndex
CREATE INDEX "leave_requests_companyId_status_idx" ON "leave_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "leave_requests_companyMemberId_idx" ON "leave_requests"("companyMemberId");

-- CreateIndex
CREATE INDEX "leave_requests_employeeProfileId_idx" ON "leave_requests"("employeeProfileId");

-- CreateIndex
CREATE INDEX "leave_requests_startDate_idx" ON "leave_requests"("startDate");

-- CreateIndex
CREATE INDEX "leave_requests_endDate_idx" ON "leave_requests"("endDate");

-- CreateIndex
CREATE INDEX "leave_requests_leaveType_idx" ON "leave_requests"("leaveType");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_companyMemberId_fkey" FOREIGN KEY ("companyMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_managerMemberId_fkey" FOREIGN KEY ("managerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open compensation record per employee (PRD #16 §189).
--
-- A raise closes the current record and opens a new one in the same
-- transaction; this is that rule stated where two concurrent raises would
-- otherwise race. Prisma cannot express a partial index, so it is written here.
CREATE UNIQUE INDEX "compensation_one_open_per_employee"
ON "compensations" ("employeeProfileId")
WHERE "effectiveTo" IS NULL;

-- Dates that run backwards are a data-entry accident, not a business case.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_dates_in_order"
CHECK ("endDate" >= "startDate");

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_days_positive"
CHECK ("days" > 0);

ALTER TABLE "compensations" ADD CONSTRAINT "compensation_period_in_order"
CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "compensations" ADD CONSTRAINT "compensation_amount_non_negative"
CHECK ("baseAmount" >= 0);

-- A balance may be adjusted downward, so adjustmentDays is unconstrained; the
-- entitlement and what has been taken cannot be negative.
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balance_non_negative"
CHECK ("entitledDays" >= 0 AND "usedDays" >= 0);

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_times_in_order"
CHECK ("checkOut" IS NULL OR "checkIn" IS NULL OR "checkOut" >= "checkIn");

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_worked_minutes_non_negative"
CHECK ("workedMinutes" IS NULL OR "workedMinutes" >= 0);

ALTER TABLE "employee_profiles" ADD CONSTRAINT "employment_dates_in_order"
CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

-- Nobody manages themselves (PRD #16 §32).
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_manager_is_somebody_else"
CHECK ("managerMemberId" IS NULL OR "managerMemberId" <> "companyMemberId");
