-- E-05A: Projects page, discovery and multi-company project access.
--
-- 1. Project status vocabulary (E-05A §10, §62). Mapped explicitly, decided
--    with the product owner on 2026-09-16 after inspecting the data:
--      DRAFT     -> PENDING
--      ACTIVE    -> ACTIVE
--      ON_HOLD   -> ACTIVE   (a paused project is still a project being worked on)
--      COMPLETED -> FINISHED
--      ARCHIVED  -> ARCHIVED
--    `preArchiveStatus` carries the same enum and is mapped the same way, so a
--    restore still returns an archived project to where it was.
--    Historical activity and audit rows keep the words they were written with:
--    they record what happened, in the vocabulary of the day.

BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'FINISHED', 'ARCHIVED');
ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING (
  CASE "status"::text
    WHEN 'DRAFT' THEN 'PENDING'
    WHEN 'ON_HOLD' THEN 'ACTIVE'
    WHEN 'COMPLETED' THEN 'FINISHED'
    ELSE "status"::text
  END
)::"ProjectStatus_new";
ALTER TABLE "projects" ALTER COLUMN "preArchiveStatus" TYPE "ProjectStatus_new" USING (
  CASE "preArchiveStatus"::text
    WHEN 'DRAFT' THEN 'PENDING'
    WHEN 'ON_HOLD' THEN 'ACTIVE'
    WHEN 'COMPLETED' THEN 'FINISHED'
    ELSE "preArchiveStatus"::text
  END
)::"ProjectStatus_new";
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "ProjectStatus_old";
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- 2. Discovery metadata (E-05A §8, §15, §18.3, §35). Additive.
ALTER TABLE "projects" ADD COLUMN "coverImageDocumentId" TEXT,
ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "projectType" TEXT;

-- 3. Backfill last activity (E-05A §15): the newest activity recorded against
--    the project, falling back to its last update. The columns hold UTC with
--    no zone, so nothing here goes through the session clock.
UPDATE "projects" AS p
SET "lastActivityAt" = COALESCE(
  (
    SELECT MAX(a."createdAt")
    FROM "activities" AS a
    WHERE a."companyId" = p."companyId"
      AND (
        (a."entityType" = 'Project' AND a."entityId" = p."id")
        OR a."metadata"->>'projectId' = p."id"
      )
  ),
  p."updatedAt"
);

CREATE INDEX "projects_companyId_lastActivityAt_idx" ON "projects"("companyId", "lastActivityAt");
CREATE INDEX "projects_coverImageDocumentId_idx" ON "projects"("coverImageDocumentId");

ALTER TABLE "projects" ADD CONSTRAINT "projects_coverImageDocumentId_fkey" FOREIGN KEY ("coverImageDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. A session moving between a person's companies is an auth event (E-05A §26).
ALTER TYPE "AuthEventType" ADD VALUE 'COMPANY_CONTEXT_SWITCHED';
