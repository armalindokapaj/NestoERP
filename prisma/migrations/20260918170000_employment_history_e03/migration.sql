-- E-03 Employment & Organization History (ADR 0004).
--
-- Additive: six enums, three history tables, three employment columns, two
-- unique keys, check and exclusion constraints, and a data backfill that gives
-- every employment its first history rows. Nothing is dropped or rewritten.
-- The data steps are re-runnable. Rollback: docs/release-readiness.md §26.

-- ---------------------------------------------------------------------------
-- 1. Refuse to guess (E-03 §184). An employment whose login belongs to another
--    company stops the migration before anything changes, with what to fix.
--    (Dates out of order cannot exist: `employment_dates_in_order`, PRD #16.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM "employee_profiles" ep
  JOIN "company_members" cm ON cm."id" = ep."companyMemberId"
  WHERE cm."companyId" <> ep."companyId";
  IF n > 0 THEN
    RAISE EXCEPTION 'E-03: % employment is linked to a login of another company; unlink it first', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Ranges over (employment, dates) need btree_gist for the equality part of
--    the no-overlap constraints below. A trusted extension.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 3. Schema.
-- ---------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "WorkLocationType" AS ENUM ('OFFICE', 'SITE', 'REMOTE', 'HYBRID', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentAssignmentReason" AS ENUM ('HIRE', 'REHIRE', 'PROMOTION', 'DEMOTION', 'TITLE_CHANGE', 'DEPARTMENT_TRANSFER', 'LEGAL_ENTITY_TRANSFER', 'MANAGER_CHANGE', 'LOCATION_CHANGE', 'EMPLOYMENT_TYPE_CHANGE', 'REORGANIZATION', 'CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentStatusReason" AS ENUM ('HIRE', 'REHIRE', 'LEAVE', 'RETURN', 'SUSPENSION', 'RESIGNATION', 'DISMISSAL', 'END_OF_CONTRACT', 'RETIREMENT', 'MUTUAL_AGREEMENT', 'LEGAL_ENTITY_TRANSFER', 'CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentHistorySource" AS ENUM ('CHANGE', 'SCHEDULED', 'CORRECTION', 'MIGRATION', 'SYNC');

-- CreateEnum
CREATE TYPE "EmploymentChangeType" AS ENUM ('POSITION_CHANGE', 'DEPARTMENT_TRANSFER', 'MANAGER_CHANGE', 'LOCATION_CHANGE', 'EMPLOYMENT_TYPE_CHANGE', 'STATUS_CHANGE', 'TERMINATION', 'LEGAL_ENTITY_TRANSFER');

-- CreateEnum
CREATE TYPE "EmploymentChangeStatus" AS ENUM ('SCHEDULED', 'APPLIED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "workLocationType" "WorkLocationType";

-- CreateTable
CREATE TABLE "employment_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "departmentId" TEXT,
    "departmentName" TEXT,
    "jobTitle" TEXT,
    "managerMemberId" TEXT,
    "managerName" TEXT,
    "workLocationType" "WorkLocationType",
    "workLocation" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" "EmploymentAssignmentReason" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentId" TEXT,
    "source" "EmploymentHistorySource" NOT NULL DEFAULT 'CHANGE',
    "note" TEXT,
    "createdByUserId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByUserId" TEXT,
    "correctsId" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_status_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "status" "EmploymentStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" "EmploymentStatusReason" NOT NULL,
    "privateReason" TEXT,
    "sourceDocumentId" TEXT,
    "source" "EmploymentHistorySource" NOT NULL DEFAULT 'CHANGE',
    "createdByUserId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByUserId" TEXT,
    "correctsId" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_changes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "type" "EmploymentChangeType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EmploymentChangeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sourceDocumentId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelReason" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employment_assignments_companyId_employeeProfileId_endDate_idx" ON "employment_assignments"("companyId", "employeeProfileId", "endDate");

-- CreateIndex
CREATE INDEX "employment_assignments_companyId_startDate_endDate_idx" ON "employment_assignments"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "employment_assignments_companyId_departmentId_startDate_end_idx" ON "employment_assignments"("companyId", "departmentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "employment_assignments_companyId_managerMemberId_startDate__idx" ON "employment_assignments"("companyId", "managerMemberId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "employment_assignments_employeeProfileId_startDate_idx" ON "employment_assignments"("employeeProfileId", "startDate");

-- CreateIndex
CREATE INDEX "employment_assignments_sourceDocumentId_idx" ON "employment_assignments"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "employment_status_history_companyId_employeeProfileId_effec_idx" ON "employment_status_history"("companyId", "employeeProfileId", "effectiveTo");

-- CreateIndex
CREATE INDEX "employment_status_history_companyId_status_effectiveFrom_ef_idx" ON "employment_status_history"("companyId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "employment_status_history_employeeProfileId_effectiveFrom_idx" ON "employment_status_history"("employeeProfileId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "employment_status_history_sourceDocumentId_idx" ON "employment_status_history"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "employment_changes_companyId_status_effectiveDate_idx" ON "employment_changes"("companyId", "status", "effectiveDate");

-- CreateIndex
CREATE INDEX "employment_changes_employeeProfileId_status_idx" ON "employment_changes"("employeeProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_companyId_key" ON "documents"("id", "companyId");

-- CreateIndex
CREATE INDEX "employee_profiles_companyId_departmentId_idx" ON "employee_profiles"("companyId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_id_companyId_key" ON "employee_profiles"("id", "companyId");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_departmentId_companyId_fkey" FOREIGN KEY ("departmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_managerMemberId_fkey" FOREIGN KEY ("managerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_sourceDocumentId_companyId_fkey" FOREIGN KEY ("sourceDocumentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_sourceDocumentId_companyId_fkey" FOREIGN KEY ("sourceDocumentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "employment_status_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_changes" ADD CONSTRAINT "employment_changes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_changes" ADD CONSTRAINT "employment_changes_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_changes" ADD CONSTRAINT "employment_changes_sourceDocumentId_companyId_fkey" FOREIGN KEY ("sourceDocumentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 4. What the database guarantees (E-03 §40, §41, §89, §176): a period ends on
--    or after it starts; one open row per employment; no two rows that are not
--    superseded overlap.
-- ---------------------------------------------------------------------------
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

CREATE UNIQUE INDEX "employment_assignments_one_open" ON "employment_assignments" ("employeeProfileId")
  WHERE "endDate" IS NULL AND "supersededAt" IS NULL AND "isPrimary";
CREATE UNIQUE INDEX "employment_status_history_one_open" ON "employment_status_history" ("employeeProfileId")
  WHERE "effectiveTo" IS NULL AND "supersededAt" IS NULL;

ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_no_overlap"
  EXCLUDE USING gist ("employeeProfileId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("supersededAt" IS NULL AND "isPrimary");
ALTER TABLE "employment_status_history" ADD CONSTRAINT "employment_status_history_no_overlap"
  EXCLUDE USING gist ("employeeProfileId" WITH =, daterange("effectiveFrom", "effectiveTo", '[]') WITH &&)
  WHERE ("supersededAt" IS NULL);

-- ---------------------------------------------------------------------------
-- 5. The current state (E-03 §183, §186). An employment with a login takes the
--    department and title its membership has; one without takes what its hire
--    confirmed. Only where still empty, so a rerun changes nothing.
-- ---------------------------------------------------------------------------
UPDATE "employee_profiles" ep
SET "departmentId" = cm."departmentId", "jobTitle" = cm."jobTitle"
FROM "company_members" cm
WHERE cm."id" = ep."companyMemberId" AND ep."departmentId" IS NULL AND ep."jobTitle" IS NULL;

UPDATE "employee_profiles" ep
SET "departmentId" = hire."targetDepartmentId", "jobTitle" = hire."targetJobTitle"
FROM (
  SELECT DISTINCT ON ("personProfileId", "targetCompanyId") "personProfileId", "targetCompanyId", "targetDepartmentId", "targetJobTitle"
  FROM "candidate_profiles"
  WHERE "status" = 'HIRED'
  ORDER BY "personProfileId", "targetCompanyId", "decidedAt" DESC NULLS LAST
) hire
WHERE ep."companyMemberId" IS NULL AND hire."personProfileId" = ep."personProfileId" AND hire."targetCompanyId" = ep."companyId"
  AND ep."departmentId" IS NULL AND ep."jobTitle" IS NULL;

-- ---------------------------------------------------------------------------
-- 6. The first history rows (E-03 §183-§185). One assignment per employment
--    from its known start date, or — not knowing it — the day the record was
--    made, marked MIGRATION: no precise date is invented. Only for an
--    employment with no history yet, so a rerun adds nothing. Dates are UTC
--    business dates, like every HR date (the server's own zone is not).
-- ---------------------------------------------------------------------------
INSERT INTO "employment_assignments" (
  "id", "companyId", "employeeProfileId", "departmentId", "departmentName", "jobTitle", "managerMemberId", "managerName",
  "workLocationType", "workLocation", "employmentType", "startDate", "endDate", "reason", "isPrimary", "source", "createdAt"
)
SELECT
  'eas_e03_' || md5(ep."id"),
  ep."companyId",
  ep."id",
  ep."departmentId",
  d."name",
  ep."jobTitle",
  ep."managerMemberId",
  CASE WHEN mu."id" IS NULL THEN NULL ELSE mu."firstName" || ' ' || mu."lastName" END,
  ep."workLocationType",
  ep."workLocation",
  ep."employmentType",
  COALESCE(ep."startDate"::date, ep."createdAt"::date),
  CASE WHEN ep."employmentStatus" = 'ENDED'
    THEN GREATEST(COALESCE(ep."endDate"::date, ep."updatedAt"::date), COALESCE(ep."startDate"::date, ep."createdAt"::date))
  END,
  'HIRE',
  true,
  'MIGRATION',
  now() AT TIME ZONE 'UTC'
FROM "employee_profiles" ep
LEFT JOIN "departments" d ON d."id" = ep."departmentId"
LEFT JOIN "company_members" m ON m."id" = ep."managerMemberId"
LEFT JOIN "users" mu ON mu."id" = m."userId"
WHERE NOT EXISTS (SELECT 1 FROM "employment_assignments" ea WHERE ea."employeeProfileId" = ep."id");

-- Status: ACTIVE from the start; a status other than ACTIVE today begins today
-- (when it began is not recorded anywhere); ENDED begins the day after the last
-- day. PLANNED is planned from the day the record was made.
WITH e AS (
  SELECT ep.*, COALESCE(ep."startDate"::date, ep."createdAt"::date) AS "start",
         (now() AT TIME ZONE 'UTC')::date AS "baseline"
  FROM "employee_profiles" ep
  WHERE NOT EXISTS (SELECT 1 FROM "employment_status_history" h WHERE h."employeeProfileId" = ep."id")
),
rows AS (
  -- PLANNED
  SELECT e."id" AS "employmentId", e."companyId", 1 AS "seq", 'PLANNED'::"EmploymentStatus" AS "status",
         e."createdAt"::date AS "from", NULL::date AS "to", 'HIRE'::"EmploymentStatusReason" AS "reason"
  FROM e WHERE e."employmentStatus" = 'PLANNED'
  UNION ALL
  -- ACTIVE, or ACTIVE until today for somebody on leave or suspended since an unknown day
  SELECT e."id", e."companyId", 1, 'ACTIVE', e."start",
         CASE
           WHEN e."employmentStatus" = 'ENDED' THEN GREATEST(COALESCE(e."endDate"::date, e."updatedAt"::date), e."start")
           WHEN e."employmentStatus" IN ('ON_LEAVE', 'SUSPENDED') THEN e."baseline" - 1
         END,
         'HIRE'
  FROM e
  WHERE e."employmentStatus" IN ('ACTIVE', 'ENDED')
     OR (e."employmentStatus" IN ('ON_LEAVE', 'SUSPENDED') AND e."start" < e."baseline")
  UNION ALL
  SELECT e."id", e."companyId", 2, e."employmentStatus", GREATEST(e."start", e."baseline"), NULL,
         CASE WHEN e."employmentStatus" = 'ON_LEAVE' THEN 'LEAVE'::"EmploymentStatusReason" ELSE 'SUSPENSION'::"EmploymentStatusReason" END
  FROM e WHERE e."employmentStatus" IN ('ON_LEAVE', 'SUSPENDED')
  UNION ALL
  SELECT e."id", e."companyId", 2, 'ENDED', GREATEST(COALESCE(e."endDate"::date, e."updatedAt"::date), e."start") + 1, NULL, 'OTHER'
  FROM e WHERE e."employmentStatus" = 'ENDED'
)
INSERT INTO "employment_status_history" ("id", "companyId", "employeeProfileId", "status", "effectiveFrom", "effectiveTo", "reason", "source", "createdAt")
SELECT 'esh_e03_' || md5(r."employmentId" || ':' || r."seq"), r."companyId", r."employmentId", r."status", r."from", r."to", r."reason", 'MIGRATION', now() AT TIME ZONE 'UTC'
FROM rows r
ON CONFLICT ("id") DO NOTHING;
