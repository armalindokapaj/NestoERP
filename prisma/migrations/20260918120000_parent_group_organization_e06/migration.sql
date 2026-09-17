-- E-06 REWORKED: parent group, group departments, department assignments,
-- access grants, platform access, person/candidate profiles and user
-- provisioning requests; roles normalised from 18 to 16.
--
-- Not additive. It deletes the ADMIN, COMPANY_IT, ARCHITECTURE_MANAGER and
-- SALES_MANAGER role rows after moving every membership, invitation and
-- approval step off them, and makes sessions.membershipId/currentCompanyId and
-- audit_events.companyId nullable. Rolling back needs a reverse migration; see
-- docs/release-readiness.md §21.

-- CreateEnum
CREATE TYPE "ParentGroupStatus" AS ENUM ('IMPLEMENTING', 'READY_FOR_VALIDATION', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DepartmentPositionLevel" AS ENUM ('GROUP_HEAD', 'COMPANY_MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "AccessScopeType" AS ENUM ('SYSTEM', 'GROUP', 'COMPANY', 'DEPARTMENT', 'PROJECT', 'RECORD', 'ASSIGNED', 'SELF');

-- CreateEnum
CREATE TYPE "PersonLifecycleStatus" AS ENUM ('CANDIDATE', 'SELECTED', 'EMPLOYEE', 'FORMER_EMPLOYEE');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('INTERVIEWING', 'SELECTED', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'PROVISIONED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DataScope" ADD VALUE 'GROUP';

-- CreateTable
CREATE TABLE "parent_groups" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "currency" TEXT,
    "logoUrl" TEXT,
    "status" "ParentGroupStatus" NOT NULL DEFAULT 'IMPLEMENTING',
    "isTestFixture" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_group_members" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_departments" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_assignments" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupDepartmentId" TEXT NOT NULL,
    "companyId" TEXT,
    "companyDepartmentId" TEXT,
    "functionalRoleKey" TEXT NOT NULL,
    "positionLevel" "DepartmentPositionLevel" NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "functionKey" TEXT,
    "scopeType" "AccessScopeType" NOT NULL,
    "scopeId" TEXT,
    "accessLevel" "AccessLevel" NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_profiles" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "jobTitle" TEXT,
    "workEmail" TEXT,
    "workPhone" TEXT,
    "personalEmail" TEXT,
    "personalPhone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "lifecycleStatus" "PersonLifecycleStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "personProfileId" TEXT NOT NULL,
    "targetCompanyId" TEXT,
    "targetDepartmentId" TEXT,
    "targetRoleKey" TEXT,
    "targetJobTitle" TEXT,
    "hiringManagerUserId" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'INTERVIEWING',
    "interviewStage" TEXT,
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_provisioning_requests" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "personProfileId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "companyId" TEXT NOT NULL,
    "companyDepartmentId" TEXT NOT NULL,
    "functionalRoleKey" TEXT NOT NULL,
    "jobTitle" TEXT,
    "managerUserId" TEXT,
    "requestedUsername" TEXT,
    "requestedActivationDate" TIMESTAMP(3),
    "notes" TEXT,
    "status" "ProvisioningStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "returnedByUserId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "provisionedUserId" TEXT,
    "provisionedByUserId" TEXT,
    "provisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provisioning_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "parentGroupId" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "parentGroupId" TEXT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "groupDepartmentId" TEXT;

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "personProfileId" TEXT,
ALTER COLUMN "companyMemberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "membershipId" DROP NOT NULL,
ALTER COLUMN "currentCompanyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "personProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "parent_groups_slug_key" ON "parent_groups"("slug");

-- CreateIndex
CREATE INDEX "parent_groups_status_idx" ON "parent_groups"("status");

-- CreateIndex
CREATE INDEX "parent_group_members_userId_idx" ON "parent_group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_group_members_parentGroupId_userId_key" ON "parent_group_members"("parentGroupId", "userId");

-- CreateIndex
CREATE INDEX "group_departments_parentGroupId_status_idx" ON "group_departments"("parentGroupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_departments_parentGroupId_key_key" ON "group_departments"("parentGroupId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "group_departments_id_parentGroupId_key" ON "group_departments"("id", "parentGroupId");

-- CreateIndex
CREATE INDEX "department_assignments_userId_status_idx" ON "department_assignments"("userId", "status");

-- CreateIndex
CREATE INDEX "department_assignments_parentGroupId_groupDepartmentId_posi_idx" ON "department_assignments"("parentGroupId", "groupDepartmentId", "positionLevel");

-- CreateIndex
CREATE INDEX "department_assignments_companyId_positionLevel_idx" ON "department_assignments"("companyId", "positionLevel");

-- CreateIndex
CREATE INDEX "department_assignments_companyDepartmentId_idx" ON "department_assignments"("companyDepartmentId");

-- CreateIndex
CREATE INDEX "access_grants_userId_parentGroupId_idx" ON "access_grants"("userId", "parentGroupId");

-- CreateIndex
CREATE INDEX "access_grants_parentGroupId_scopeType_scopeId_idx" ON "access_grants"("parentGroupId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_access_userId_key" ON "platform_access"("userId");

-- CreateIndex
CREATE INDEX "person_profiles_parentGroupId_lastName_firstName_idx" ON "person_profiles"("parentGroupId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "person_profiles_parentGroupId_lifecycleStatus_idx" ON "person_profiles"("parentGroupId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "person_profiles_workEmail_idx" ON "person_profiles"("workEmail");

-- CreateIndex
CREATE UNIQUE INDEX "person_profiles_id_parentGroupId_key" ON "person_profiles"("id", "parentGroupId");

-- CreateIndex
CREATE INDEX "candidate_profiles_parentGroupId_status_idx" ON "candidate_profiles"("parentGroupId", "status");

-- CreateIndex
CREATE INDEX "candidate_profiles_personProfileId_idx" ON "candidate_profiles"("personProfileId");

-- CreateIndex
CREATE INDEX "candidate_profiles_targetCompanyId_status_idx" ON "candidate_profiles"("targetCompanyId", "status");

-- CreateIndex
CREATE INDEX "user_provisioning_requests_parentGroupId_status_idx" ON "user_provisioning_requests"("parentGroupId", "status");

-- CreateIndex
CREATE INDEX "user_provisioning_requests_companyId_status_idx" ON "user_provisioning_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "user_provisioning_requests_personProfileId_idx" ON "user_provisioning_requests"("personProfileId");

-- CreateIndex
CREATE INDEX "audit_events_parentGroupId_occurredAt_id_idx" ON "audit_events"("parentGroupId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "companies_parentGroupId_idx" ON "companies"("parentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_parentGroupId_key" ON "companies"("id", "parentGroupId");

-- CreateIndex
CREATE INDEX "departments_groupDepartmentId_idx" ON "departments"("groupDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_companyId_key" ON "departments"("id", "companyId");

-- CreateIndex
CREATE INDEX "employee_profiles_personProfileId_idx" ON "employee_profiles"("personProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "users_personProfileId_key" ON "users"("personProfileId");

-- ---------------------------------------------------------------------------
-- Backfill (E-06 §151-§157). Everything below preserves ids: no company, user,
-- membership or department is recreated.
-- ---------------------------------------------------------------------------

-- One parent group per existing company. Putting existing companies together
-- would open group-level access between tenants nobody said belong together;
-- a company is moved into a shared group deliberately, never by migration.
INSERT INTO "parent_groups" ("id", "slug", "name", "legalName", "country", "status", "activatedAt", "createdAt", "updatedAt")
SELECT 'group_' || c."id", c."slug", c."name", c."legalName", c."country", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" c;

UPDATE "companies" SET "parentGroupId" = 'group_' || "id";

-- The master group departments (E-06 §11), once per group.
INSERT INTO "group_departments" ("id", "parentGroupId", "key", "name", "createdAt", "updatedAt")
SELECT g."id" || ':' || d.key, g."id", d.key, d.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "parent_groups" g
CROSS JOIN (VALUES
  ('executive', 'Executive'), ('it', 'IT'), ('hr', 'HR'), ('projects', 'Projects'),
  ('architecture', 'Architecture'), ('engineering', 'Engineering'), ('finance', 'Finance'),
  ('legal', 'Legal'), ('sales', 'Sales'), ('procurement', 'Procurement'),
  ('inventory', 'Inventory'), ('qaqc', 'QA/QC'), ('hse', 'HSE')
) AS d(key, name);

-- Existing departments become branches where their key names a function.
-- "management" is the executive function under an older name; a department
-- matching no function keeps no link rather than a guessed one.
UPDATE "departments" dep
SET "groupDepartmentId" = gd."id"
FROM "companies" c, "group_departments" gd
WHERE c."id" = dep."companyId"
  AND gd."parentGroupId" = c."parentGroupId"
  AND gd."key" = CASE dep."key" WHEN 'management' THEN 'executive' ELSE dep."key" END;

-- The person behind every membership (E-06 §22, §25): one per person per group.
INSERT INTO "person_profiles" ("id", "parentGroupId", "firstName", "lastName", "jobTitle", "workEmail", "workPhone", "lifecycleStatus", "createdAt", "updatedAt")
SELECT DISTINCT ON (m."userId", c."parentGroupId")
  'person_' || md5(m."userId" || ':' || c."parentGroupId"),
  c."parentGroupId", u."firstName", u."lastName", m."jobTitle", u."email", u."phone",
  (CASE WHEN ep."employmentStatus" = 'ENDED' THEN 'FORMER_EMPLOYEE' ELSE 'EMPLOYEE' END)::"PersonLifecycleStatus",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "company_members" m
JOIN "users" u ON u."id" = m."userId"
JOIN "companies" c ON c."id" = m."companyId"
LEFT JOIN "employee_profiles" ep ON ep."companyMemberId" = m."id"
ORDER BY m."userId", c."parentGroupId", m."createdAt";

UPDATE "employee_profiles" ep
SET "personProfileId" = 'person_' || md5(m."userId" || ':' || c."parentGroupId")
FROM "company_members" m, "companies" c
WHERE m."id" = ep."companyMemberId" AND c."id" = ep."companyId";

-- A login links to one person: the one in the group of its oldest membership.
UPDATE "users" u
SET "personProfileId" = oldest."personId"
FROM (
  SELECT DISTINCT ON (m."userId") m."userId", 'person_' || md5(m."userId" || ':' || c."parentGroupId") AS "personId"
  FROM "company_members" m JOIN "companies" c ON c."id" = m."companyId"
  ORDER BY m."userId", m."createdAt"
) oldest
WHERE oldest."userId" = u."id";

-- Roles (E-06 §6, §152-§156). COMPANY_IT is renamed in place, so every
-- membership on it keeps its row and simply becomes Group IT.
UPDATE "roles" SET "key" = 'GROUP_IT', "name" = 'Group IT', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'COMPANY_IT' AND NOT EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'GROUP_IT');

INSERT INTO "roles" ("id", "key", "name", "createdAt", "updatedAt")
SELECT 'role_group_it', 'GROUP_IT', 'Group IT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'GROUP_IT');

-- Department managers keep their authority as a position, not a role
-- (E-06 §153, §154): the function's role plus a company-manager assignment in
-- the branch they belonged to, or the company's branch of that function.
INSERT INTO "department_assignments" ("id", "parentGroupId", "userId", "groupDepartmentId", "companyId", "companyDepartmentId", "functionalRoleKey", "positionLevel", "accessLevel", "status", "createdAt", "updatedAt")
SELECT
  'assignment_' || m."id",
  c."parentGroupId",
  m."userId",
  gd."id",
  m."companyId",
  (SELECT dep."id" FROM "departments" dep
    WHERE dep."companyId" = m."companyId" AND dep."groupDepartmentId" = gd."id"
    ORDER BY (dep."id" = m."departmentId") DESC, dep."createdAt"
    LIMIT 1),
  CASE r."key" WHEN 'ARCHITECTURE_MANAGER' THEN 'ARCHITECT' ELSE 'SALES' END,
  'COMPANY_MANAGER',
  'MANAGE',
  m."status",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "company_members" m
JOIN "roles" r ON r."id" = m."roleId"
JOIN "companies" c ON c."id" = m."companyId"
JOIN "group_departments" gd ON gd."parentGroupId" = c."parentGroupId"
  AND gd."key" = CASE r."key" WHEN 'ARCHITECTURE_MANAGER' THEN 'architecture' ELSE 'sales' END
WHERE r."key" IN ('ARCHITECTURE_MANAGER', 'SALES_MANAGER');

-- Old key → the role that replaces it. An Admin was a company administrator,
-- which is Group IT's technical authority now; nobody becomes a Platform Admin
-- by migration (E-06 §155).
CREATE TEMP TABLE "e06_role_map" ("old" TEXT PRIMARY KEY, "new" TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO "e06_role_map" VALUES ('ADMIN', 'GROUP_IT'), ('ARCHITECTURE_MANAGER', 'ARCHITECT'), ('SALES_MANAGER', 'SALES'), ('COMPANY_IT', 'GROUP_IT');

UPDATE "company_members" m
SET "roleId" = new_role."id", "accessVersion" = m."accessVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
FROM "roles" old_role, "e06_role_map" map, "roles" new_role
WHERE old_role."id" = m."roleId" AND map."old" = old_role."key" AND new_role."key" = map."new";

UPDATE "company_invites" i
SET "roleId" = new_role."id"
FROM "roles" old_role, "e06_role_map" map, "roles" new_role
WHERE old_role."id" = i."roleId" AND map."old" = old_role."key" AND new_role."key" = map."new";

UPDATE "approval_steps" s SET "approverRoleKey" = map."new"
FROM "e06_role_map" map WHERE s."approverRoleKey" = map."old";

UPDATE "procurement_approval_policies" p SET "executiveRoleKey" = map."new"
FROM "e06_role_map" map WHERE p."executiveRoleKey" = map."old";

-- Nothing references the retired rows any more; their permission rows cascade.
DELETE FROM "roles" r
WHERE r."key" IN ('ADMIN', 'ARCHITECTURE_MANAGER', 'SALES_MANAGER', 'COMPANY_IT')
  AND NOT EXISTS (SELECT 1 FROM "company_members" m WHERE m."roleId" = r."id");

-- Contract: the backfilled columns are required from here on.
ALTER TABLE "companies" ALTER COLUMN "parentGroupId" SET NOT NULL;
ALTER TABLE "employee_profiles" ALTER COLUMN "personProfileId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_personProfileId_fkey" FOREIGN KEY ("personProfileId") REFERENCES "person_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_groupDepartmentId_fkey" FOREIGN KEY ("groupDepartmentId") REFERENCES "group_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_group_members" ADD CONSTRAINT "parent_group_members_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_group_members" ADD CONSTRAINT "parent_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_departments" ADD CONSTRAINT "group_departments_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_groupDepartmentId_parentGroupId_fkey" FOREIGN KEY ("groupDepartmentId", "parentGroupId") REFERENCES "group_departments"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_companyId_parentGroupId_fkey" FOREIGN KEY ("companyId", "parentGroupId") REFERENCES "companies"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_companyDepartmentId_companyId_fkey" FOREIGN KEY ("companyDepartmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_access" ADD CONSTRAINT "platform_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_personProfileId_parentGroupId_fkey" FOREIGN KEY ("personProfileId", "parentGroupId") REFERENCES "person_profiles"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_targetCompanyId_parentGroupId_fkey" FOREIGN KEY ("targetCompanyId", "parentGroupId") REFERENCES "companies"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_targetDepartmentId_targetCompanyId_fkey" FOREIGN KEY ("targetDepartmentId", "targetCompanyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_personProfileId_parentGroupId_fkey" FOREIGN KEY ("personProfileId", "parentGroupId") REFERENCES "person_profiles"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_companyId_parentGroupId_fkey" FOREIGN KEY ("companyId", "parentGroupId") REFERENCES "companies"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_companyDepartmentId_companyId_fkey" FOREIGN KEY ("companyDepartmentId", "companyId") REFERENCES "departments"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provisioning_requests" ADD CONSTRAINT "user_provisioning_requests_provisionedUserId_fkey" FOREIGN KEY ("provisionedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_personProfileId_fkey" FOREIGN KEY ("personProfileId") REFERENCES "person_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the relations alone cannot state.
-- ---------------------------------------------------------------------------

-- A group head belongs to no company; a company manager always does; a branch is
-- only ever named together with its company (a composite key with a null column
-- is not checked, so the pairing is enforced here).
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_position_scope_check"
  CHECK (("positionLevel" <> 'GROUP_HEAD' OR "companyId" IS NULL)
     AND ("positionLevel" <> 'COMPANY_MANAGER' OR "companyId" IS NOT NULL)
     AND ("companyDepartmentId" IS NULL OR "companyId" IS NOT NULL));

-- One live assignment per person, function, company and position.
CREATE UNIQUE INDEX "department_assignments_one_active"
  ON "department_assignments" ("userId", "groupDepartmentId", COALESCE("companyId", ''), "positionLevel")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_department_company_check"
  CHECK ("targetDepartmentId" IS NULL OR "targetCompanyId" IS NOT NULL);

-- One open account request per person (E-06 §83: no duplicate identities).
CREATE UNIQUE INDEX "user_provisioning_requests_one_open_per_person"
  ON "user_provisioning_requests" ("personProfileId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS');
