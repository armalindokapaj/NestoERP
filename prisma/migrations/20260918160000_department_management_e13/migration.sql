-- E-13 Group & Company Department Management (ADR 0003).
--
-- Additive: two columns, four unique indexes, one check constraint and a data
-- backfill. Nothing is dropped or rewritten. Re-runnable in its data steps.
-- Rollback: docs/release-readiness.md §25.

-- ---------------------------------------------------------------------------
-- 1. Refuse to guess (E-13 §104, §105). Every rule the indexes below enforce is
--    checked first, before anything changes, and a violation stops the
--    migration with what to fix instead of picking a winner.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT "groupDepartmentId", "companyId" FROM "departments"
    WHERE "groupDepartmentId" IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'E-13: % company has more than one branch of the same group department; merge them first', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "parentGroupId", "name" FROM "group_departments" GROUP BY 1, 2 HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'E-13: % group department name is used twice in one group; rename one first', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "groupDepartmentId" FROM "department_assignments"
    WHERE "status" = 'ACTIVE' AND "positionLevel" = 'GROUP_HEAD'
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'E-13: % group department has more than one active head; end all but one first', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "companyDepartmentId" FROM "department_assignments"
    WHERE "status" = 'ACTIVE' AND "positionLevel" = 'COMPANY_MANAGER' AND "companyDepartmentId" IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'E-13: % company department has more than one active manager; end all but one first', n;
  END IF;

  SELECT count(*) INTO n FROM "department_assignments"
  WHERE "positionLevel" = 'COMPANY_MANAGER' AND "companyDepartmentId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'E-13: % company manager position names no branch; end it or give it its branch first', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The department's code (E-13 §10) and who created it (§8).
-- ---------------------------------------------------------------------------
ALTER TABLE "group_departments" ADD COLUMN "code" TEXT;
ALTER TABLE "group_departments" ADD COLUMN "createdByUserId" TEXT;

-- The chart's functions get the codes `config/group-departments.ts` gives new
-- groups; anything else its key, upper-cased, numbered where two would meet.
UPDATE "group_departments" g
SET "code" = numbered.code
FROM (
  SELECT id,
         CASE WHEN row_number() OVER (PARTITION BY "parentGroupId", base ORDER BY "createdAt", id) = 1 THEN base
              ELSE base || row_number() OVER (PARTITION BY "parentGroupId", base ORDER BY "createdAt", id)::text
         END AS code
  FROM (
    SELECT id, "parentGroupId", "createdAt",
           CASE "key"
             WHEN 'executive' THEN 'EXEC'
             WHEN 'it' THEN 'IT'
             WHEN 'hr' THEN 'HR'
             WHEN 'projects' THEN 'PROJ'
             WHEN 'architecture' THEN 'ARCH'
             WHEN 'engineering' THEN 'ENG'
             WHEN 'finance' THEN 'FIN'
             WHEN 'legal' THEN 'LEGAL'
             WHEN 'sales' THEN 'SALES'
             WHEN 'procurement' THEN 'PROC'
             WHEN 'inventory' THEN 'INV'
             WHEN 'qaqc' THEN 'QAQC'
             WHEN 'hse' THEN 'HSE'
             ELSE left(upper(regexp_replace("key", '[^a-zA-Z0-9]', '', 'g')), 10)
           END AS base
    FROM "group_departments"
    WHERE "code" IS NULL
  ) based
) numbered
WHERE g.id = numbered.id;

ALTER TABLE "group_departments" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "group_departments_parentGroupId_code_key" ON "group_departments"("parentGroupId", "code");
CREATE UNIQUE INDEX "group_departments_parentGroupId_name_key" ON "group_departments"("parentGroupId", "name");

-- ---------------------------------------------------------------------------
-- 3. One branch per group department and company (E-13 §16).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "departments_groupDepartmentId_companyId_key" ON "departments"("groupDepartmentId", "companyId");

-- ---------------------------------------------------------------------------
-- 4. One active head per group department and one active manager per branch
--    (E-13 §66, §136): two racing appointments cannot both commit.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "department_assignments_one_head"
  ON "department_assignments" ("groupDepartmentId")
  WHERE "status" = 'ACTIVE' AND "positionLevel" = 'GROUP_HEAD';

CREATE UNIQUE INDEX "department_assignments_one_manager"
  ON "department_assignments" ("companyDepartmentId")
  WHERE "status" = 'ACTIVE' AND "positionLevel" = 'COMPANY_MANAGER';

-- A company manager manages a branch, always.
ALTER TABLE "department_assignments" ADD CONSTRAINT "department_assignments_manager_branch_check"
  CHECK ("positionLevel" <> 'COMPANY_MANAGER' OR "companyDepartmentId" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Membership becomes an assignment (E-13 §24-§29). Everybody placed in a
--    branch today — an active membership whose department is a branch of its
--    own group's department — gets the MEMBER row the branch's team is read
--    from. Deterministic ids; a row that already exists is left alone, so a
--    second run inserts nothing.
-- ---------------------------------------------------------------------------
INSERT INTO "department_assignments" (
  "id", "parentGroupId", "userId", "groupDepartmentId", "companyId", "companyDepartmentId",
  "functionalRoleKey", "positionLevel", "accessLevel", "status", "startsAt", "createdAt", "updatedAt"
)
SELECT 'dam_e13_' || md5(m."id" || ':' || d."id"),
       c."parentGroupId", m."userId", d."groupDepartmentId", m."companyId", d."id",
       r."key", 'MEMBER', 'CONTRIBUTE', 'ACTIVE', COALESCE(m."joinedAt", m."createdAt"),
       -- Prisma stores UTC in timestamp-without-zone columns; now() alone is the server's local time.
       now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM "company_members" m
JOIN "departments" d ON d."id" = m."departmentId" AND d."companyId" = m."companyId"
JOIN "companies" c ON c."id" = m."companyId"
JOIN "group_departments" g ON g."id" = d."groupDepartmentId" AND g."parentGroupId" = c."parentGroupId"
JOIN "roles" r ON r."id" = m."roleId"
WHERE m."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "department_assignments" a
    WHERE a."userId" = m."userId" AND a."companyDepartmentId" = d."id"
      AND a."positionLevel" = 'MEMBER' AND a."status" = 'ACTIVE'
  )
ON CONFLICT DO NOTHING;
