-- E-05A (final): project types become each company's own list.
--
-- The first E-05A pass stored a key from a code-defined list
-- (`projects.projectType`). The final PRD asks for a configurable reference
-- rather than a construction-only enum (E-05A §30, §62), so each company gets
-- its own `project_types` rows, starting from the same eight defaults, and a
-- project points at one of them.
--
-- Order matters: the defaults are inserted and every project mapped before the
-- old column is dropped, so no project loses its type.

-- 1. The list.
CREATE TABLE "project_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_types_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_types_companyId_isActive_sortOrder_idx" ON "project_types"("companyId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "project_types_companyId_name_key" ON "project_types"("companyId", "name");
ALTER TABLE "project_types" ADD CONSTRAINT "project_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Every existing company starts with the defaults (config/project-types.ts).
--    Ids are derived from the company and the name, so the migration is
--    deterministic on every copy of the database.
INSERT INTO "project_types" ("id", "companyId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT 'ptype_' || substr(md5(c."id" || ':' || d."name"), 1, 24), c."id", d."name", d."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
CROSS JOIN (
  VALUES
    ('Residential', 1),
    ('Commercial', 2),
    ('Hospital', 3),
    ('Hotel', 4),
    ('Industrial', 5),
    ('Infrastructure', 6),
    ('Mixed use', 7),
    ('Other', 8)
) AS d("name", "sortOrder");

-- 3. A key the code list never had (none exist today) becomes a type of its
--    own rather than being dropped.
INSERT INTO "project_types" ("id", "companyId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT DISTINCT ON (p."companyId", p."projectType")
  'ptype_' || substr(md5(p."companyId" || ':' || p."projectType"), 1, 24), p."companyId", p."projectType", 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "projects" AS p
WHERE p."projectType" IS NOT NULL
  AND p."projectType" NOT IN ('RESIDENTIAL', 'COMMERCIAL', 'HOSPITAL', 'HOTEL', 'INDUSTRIAL', 'INFRASTRUCTURE', 'MIXED_USE', 'OTHER')
ON CONFLICT ("companyId", "name") DO NOTHING;

-- 4. Point every typed project at its company's row.
ALTER TABLE "projects" ADD COLUMN "projectTypeId" TEXT;

UPDATE "projects" AS p
SET "projectTypeId" = t."id"
FROM "project_types" AS t
WHERE p."projectType" IS NOT NULL
  AND t."companyId" = p."companyId"
  AND t."name" = CASE p."projectType"
    WHEN 'RESIDENTIAL' THEN 'Residential'
    WHEN 'COMMERCIAL' THEN 'Commercial'
    WHEN 'HOSPITAL' THEN 'Hospital'
    WHEN 'HOTEL' THEN 'Hotel'
    WHEN 'INDUSTRIAL' THEN 'Industrial'
    WHEN 'INFRASTRUCTURE' THEN 'Infrastructure'
    WHEN 'MIXED_USE' THEN 'Mixed use'
    WHEN 'OTHER' THEN 'Other'
    ELSE p."projectType"
  END;

-- 5. Only now does the key column go.
ALTER TABLE "projects" DROP COLUMN "projectType";

CREATE INDEX "projects_projectTypeId_idx" ON "projects"("projectTypeId");
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Discovery across companies filters on status and orders by activity
--    (E-05A §61).
CREATE INDEX "projects_status_lastActivityAt_idx" ON "projects"("status", "lastActivityAt");
