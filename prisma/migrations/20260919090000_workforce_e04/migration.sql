-- E-04: Workforce employees and employees without a NESTO account (ADR 0006).
--
-- Additive, except that three columns stop being required: attendance, leave
-- requests and leave balances belonged to a login (companyMemberId NOT NULL),
-- and now belong to the employment, which may have none (E-04 §7, §51). The
-- attendance unique key moves from (login, day) to (employment, day) — the same
-- rows, since an employment has at most one login.
--
-- Rollback: release-readiness §28.

-- CreateEnum
CREATE TYPE "WorkerCategory" AS ENUM ('OFFICE', 'FIELD', 'SITE', 'CONSTRUCTION_WORKER', 'DRIVER', 'TECHNICIAN', 'SUPERVISOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectSiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkforceCrewStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HseIncidentInvolvement" AS ENUM ('INJURED', 'WITNESS', 'INVOLVED');

-- CreateEnum
CREATE TYPE "EmployeeImportStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'SITE';

-- DropIndex
DROP INDEX "attendance_records_companyMemberId_date_key";

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "crewId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "siteId" TEXT,
ALTER COLUMN "companyMemberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "daily_log_workforce_entries" ADD COLUMN     "crewId" TEXT;

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "tradeId" TEXT,
ADD COLUMN     "workerCategory" "WorkerCategory";

-- AlterTable
ALTER TABLE "leave_balances" ALTER COLUMN "companyMemberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "leave_requests" ALTER COLUMN "companyMemberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ppe_checks" ADD COLUMN     "subjectEmployeeProfileId" TEXT;

-- AlterTable
ALTER TABLE "toolbox_talk_participants" ADD COLUMN     "employeeProfileId" TEXT;

-- CreateTable
CREATE TABLE "project_sites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "status" "ProjectSiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workforce_trades" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByMemberId" TEXT,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workforce_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workforce_crews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "siteId" TEXT,
    "tradeId" TEXT,
    "supervisorEmployeeId" TEXT,
    "status" "WorkforceCrewStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workforce_crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workforce_crew_members" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "role" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "endReason" TEXT,
    "createdByUserId" TEXT,
    "endedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workforce_crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_project_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "tradeId" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "endReason" TEXT,
    "createdByUserId" TEXT,
    "endedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_import_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "EmployeeImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "rowCount" INTEGER NOT NULL,
    "validCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "includesPay" BOOLEAN NOT NULL DEFAULT false,
    "rows" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3),
    "committedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_incident_people" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "externalName" TEXT,
    "involvement" "HseIncidentInvolvement" NOT NULL,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hse_incident_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_work_permit_workers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "crewId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hse_work_permit_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_inductions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "inductedOn" DATE NOT NULL,
    "validUntil" DATE,
    "conductedByMemberId" TEXT NOT NULL,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByMemberId" TEXT,
    "voidReason" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_inductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_sites_companyId_projectId_status_idx" ON "project_sites"("companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_sites_projectId_name_key" ON "project_sites"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_sites_id_projectId_key" ON "project_sites"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_sites_id_companyId_key" ON "project_sites"("id", "companyId");

-- CreateIndex
CREATE INDEX "workforce_trades_companyId_isActive_sortOrder_idx" ON "workforce_trades"("companyId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "workforce_trades_companyId_name_key" ON "workforce_trades"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workforce_trades_id_companyId_key" ON "workforce_trades"("id", "companyId");

-- CreateIndex
CREATE INDEX "workforce_crews_companyId_status_idx" ON "workforce_crews"("companyId", "status");

-- CreateIndex
CREATE INDEX "workforce_crews_companyId_projectId_idx" ON "workforce_crews"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "workforce_crews_supervisorEmployeeId_idx" ON "workforce_crews"("supervisorEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "workforce_crews_companyId_name_key" ON "workforce_crews"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workforce_crews_id_companyId_key" ON "workforce_crews"("id", "companyId");

-- CreateIndex
CREATE INDEX "workforce_crew_members_companyId_crewId_endDate_idx" ON "workforce_crew_members"("companyId", "crewId", "endDate");

-- CreateIndex
CREATE INDEX "workforce_crew_members_companyId_employeeProfileId_endDate_idx" ON "workforce_crew_members"("companyId", "employeeProfileId", "endDate");

-- CreateIndex
CREATE INDEX "employee_project_assignments_companyId_projectId_endDate_idx" ON "employee_project_assignments"("companyId", "projectId", "endDate");

-- CreateIndex
CREATE INDEX "employee_project_assignments_companyId_employeeProfileId_en_idx" ON "employee_project_assignments"("companyId", "employeeProfileId", "endDate");

-- CreateIndex
CREATE INDEX "employee_project_assignments_companyId_siteId_endDate_idx" ON "employee_project_assignments"("companyId", "siteId", "endDate");

-- CreateIndex
CREATE INDEX "employee_import_batches_companyId_createdAt_idx" ON "employee_import_batches"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "hse_incident_people_companyId_employeeProfileId_idx" ON "hse_incident_people"("companyId", "employeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_incident_people_incidentId_employeeProfileId_key" ON "hse_incident_people"("incidentId", "employeeProfileId");

-- CreateIndex
CREATE INDEX "hse_work_permit_workers_companyId_employeeProfileId_idx" ON "hse_work_permit_workers"("companyId", "employeeProfileId");

-- CreateIndex
CREATE INDEX "hse_work_permit_workers_companyId_crewId_idx" ON "hse_work_permit_workers"("companyId", "crewId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_work_permit_workers_permitId_employeeProfileId_key" ON "hse_work_permit_workers"("permitId", "employeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_work_permit_workers_permitId_crewId_key" ON "hse_work_permit_workers"("permitId", "crewId");

-- CreateIndex
CREATE INDEX "hse_inductions_companyId_employeeProfileId_inductedOn_idx" ON "hse_inductions"("companyId", "employeeProfileId", "inductedOn");

-- CreateIndex
CREATE INDEX "hse_inductions_companyId_projectId_inductedOn_idx" ON "hse_inductions"("companyId", "projectId", "inductedOn");

-- CreateIndex
CREATE INDEX "hse_inductions_conductedByMemberId_idx" ON "hse_inductions"("conductedByMemberId");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_employeeProfileId_date_idx" ON "attendance_records"("companyId", "employeeProfileId", "date");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_projectId_date_idx" ON "attendance_records"("companyId", "projectId", "date");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_siteId_date_idx" ON "attendance_records"("companyId", "siteId", "date");

-- CreateIndex
CREATE INDEX "attendance_records_companyId_crewId_date_idx" ON "attendance_records"("companyId", "crewId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeProfileId_date_key" ON "attendance_records"("employeeProfileId", "date");

-- CreateIndex
CREATE INDEX "daily_log_workforce_entries_companyId_crewId_idx" ON "daily_log_workforce_entries"("companyId", "crewId");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_workerCategory_idx" ON "employee_profiles"("companyId", "workerCategory");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_tradeId_idx" ON "employee_profiles"("companyId", "tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_incidents_id_companyId_key" ON "hse_incidents"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_work_permits_id_companyId_key" ON "hse_work_permits"("id", "companyId");

-- CreateIndex
CREATE INDEX "ppe_checks_subjectEmployeeProfileId_idx" ON "ppe_checks"("subjectEmployeeProfileId");

-- CreateIndex
CREATE INDEX "toolbox_talk_participants_employeeProfileId_idx" ON "toolbox_talk_participants"("employeeProfileId");

-- AddForeignKey
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_tradeId_companyId_fkey" FOREIGN KEY ("tradeId", "companyId") REFERENCES "workforce_trades"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_trades" ADD CONSTRAINT "workforce_trades_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_siteId_projectId_fkey" FOREIGN KEY ("siteId", "projectId") REFERENCES "project_sites"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_tradeId_companyId_fkey" FOREIGN KEY ("tradeId", "companyId") REFERENCES "workforce_trades"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_supervisorEmployeeId_companyId_fkey" FOREIGN KEY ("supervisorEmployeeId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_crewId_companyId_fkey" FOREIGN KEY ("crewId", "companyId") REFERENCES "workforce_crews"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_siteId_projectId_fkey" FOREIGN KEY ("siteId", "projectId") REFERENCES "project_sites"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_tradeId_companyId_fkey" FOREIGN KEY ("tradeId", "companyId") REFERENCES "workforce_trades"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_import_batches" ADD CONSTRAINT "employee_import_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_siteId_projectId_fkey" FOREIGN KEY ("siteId", "projectId") REFERENCES "project_sites"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_crewId_companyId_fkey" FOREIGN KEY ("crewId", "companyId") REFERENCES "workforce_crews"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talk_participants" ADD CONSTRAINT "toolbox_talk_participants_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_subjectEmployeeProfileId_companyId_fkey" FOREIGN KEY ("subjectEmployeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incident_people" ADD CONSTRAINT "hse_incident_people_incidentId_companyId_fkey" FOREIGN KEY ("incidentId", "companyId") REFERENCES "hse_incidents"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incident_people" ADD CONSTRAINT "hse_incident_people_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permit_workers" ADD CONSTRAINT "hse_work_permit_workers_permitId_companyId_fkey" FOREIGN KEY ("permitId", "companyId") REFERENCES "hse_work_permits"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permit_workers" ADD CONSTRAINT "hse_work_permit_workers_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permit_workers" ADD CONSTRAINT "hse_work_permit_workers_crewId_companyId_fkey" FOREIGN KEY ("crewId", "companyId") REFERENCES "workforce_crews"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_siteId_projectId_fkey" FOREIGN KEY ("siteId", "projectId") REFERENCES "project_sites"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_conductedByMemberId_fkey" FOREIGN KEY ("conductedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_workforce_entries" ADD CONSTRAINT "daily_log_workforce_entries_crewId_companyId_fkey" FOREIGN KEY ("crewId", "companyId") REFERENCES "workforce_crews"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Invariants the schema language cannot say (E-04 §30, §41, §42, §221, §222).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "hse_inductions" ADD CONSTRAINT "hse_inductions_dates_check" CHECK ("validUntil" IS NULL OR "validUntil" >= "inductedOn");

-- One crew at a time: an employee's crew periods never overlap.
ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_no_overlap"
  EXCLUDE USING gist ("employeeProfileId" WITH =, daterange("startDate", "endDate", '[]') WITH &&);
-- Never twice on the same project at once, and one primary project at a time.
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_no_overlap"
  EXCLUDE USING gist ("employeeProfileId" WITH =, "projectId" WITH =, daterange("startDate", "endDate", '[]') WITH &&);
ALTER TABLE "employee_project_assignments" ADD CONSTRAINT "employee_project_assignments_one_primary"
  EXCLUDE USING gist ("employeeProfileId" WITH =, daterange("startDate", "endDate", '[]') WITH &&) WHERE ("isPrimary");

-- A participant, a subject or a person involved is exactly one kind of somebody.
ALTER TABLE "toolbox_talk_participants" ADD CONSTRAINT "toolbox_talk_participants_one_subject"
  CHECK (num_nonnulls("companyMemberId", "employeeProfileId", "externalName") <= 1);
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_one_subject"
  CHECK (num_nonnulls("subjectMemberId", "subjectEmployeeProfileId", "externalSubjectName") <= 1);
ALTER TABLE "hse_incident_people" ADD CONSTRAINT "hse_incident_people_one_subject"
  CHECK (num_nonnulls("employeeProfileId", "externalName") = 1);
ALTER TABLE "hse_work_permit_workers" ADD CONSTRAINT "hse_work_permit_workers_one_subject"
  CHECK (num_nonnulls("employeeProfileId", "crewId") = 1);
-- A site on a record needs the project it belongs to.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_site_needs_project" CHECK ("siteId" IS NULL OR "projectId" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Data: an employee record is addressed by its employment, not its login
-- (E-04 §7, §14, §190-§196). Everything that named an employee record by the
-- login's membership id now names the employment. Deterministic, and a rerun
-- changes nothing: a row already naming an employment matches no membership.
-- ---------------------------------------------------------------------------
UPDATE "documents" d SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE d."entityType" = 'employee' AND ep."companyMemberId" = d."entityId" AND ep."companyId" = d."companyId";

UPDATE "activities" a SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE a."entityType" = 'EmployeeProfile' AND ep."companyMemberId" = a."entityId" AND ep."companyId" = a."companyId";

UPDATE "tasks" t SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE t."entityType" = 'employee' AND ep."companyMemberId" = t."entityId" AND ep."companyId" = t."companyId";

UPDATE "collaboration_threads" c SET "parentId" = ep."id"
  FROM "employee_profiles" ep
  WHERE c."parentType" = 'employee' AND ep."companyMemberId" = c."parentId";

UPDATE "notifications" n SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE n."entityType" = 'employee' AND ep."companyMemberId" = n."entityId";

UPDATE "attention_items" i SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE i."entityType" = 'employee' AND ep."companyMemberId" = i."entityId";

UPDATE "notification_event_outbox" o SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE o."entityType" = 'employee' AND ep."companyMemberId" = o."entityId";

UPDATE "user_favorites" f SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE f."entityType" = 'employee' AND ep."companyMemberId" = f."entityId";

UPDATE "recent_items" r SET "entityId" = ep."id"
  FROM "employee_profiles" ep
  WHERE r."entityType" = 'employee' AND ep."companyMemberId" = r."entityId";
