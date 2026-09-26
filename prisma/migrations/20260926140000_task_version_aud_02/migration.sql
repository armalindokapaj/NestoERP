-- AUD-02 §3, §9: the task's version is the concurrency authority for every change.
--
-- Every existing and every new task starts at version 1. The task service names
-- the version its user reviewed in the `where` of each write and increments it
-- once in the same statement.
--
-- The trigger is the safety net for every other writer: a seed, a repair
-- script, raw SQL, or a referential action (`ON DELETE SET NULL` on the project
-- and the assignee) that changes a protected column without changing the
-- version gets the increment anyway, so a browser that reviewed the old values
-- cannot save over the new ones. A writer that does move the version may only
-- move it forward by one; a reset or a jump is refused. The overflow of an
-- integer version is refused by Postgres itself rather than wrapped.
--
-- Additive (LOW risk). Rollback: keep the column (AUD-02 §9); drop only the
-- trigger and function if they must go:
--   DROP TRIGGER "tasks_version_guard" ON "tasks"; DROP FUNCTION "tasks_version_guard"();

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION "tasks_version_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."version" IS DISTINCT FROM OLD."version" THEN
    IF NEW."version" IS NULL OR NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'task % version may only advance by one (from % to %)', OLD."id", OLD."version", NEW."version"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."assigneeMemberId" IS DISTINCT FROM OLD."assigneeMemberId"
    OR NEW."createdByMemberId" IS DISTINCT FROM OLD."createdByMemberId"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."preArchiveStatus" IS DISTINCT FROM OLD."preArchiveStatus"
    OR NEW."priority" IS DISTINCT FROM OLD."priority"
    OR NEW."startDate" IS DISTINCT FROM OLD."startDate"
    OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    OR NEW."blockedAt" IS DISTINCT FROM OLD."blockedAt"
    OR NEW."blockedReason" IS DISTINCT FROM OLD."blockedReason"
    OR NEW."blockedByMemberId" IS DISTINCT FROM OLD."blockedByMemberId"
    OR NEW."module" IS DISTINCT FROM OLD."module"
    OR NEW."entityType" IS DISTINCT FROM OLD."entityType"
    OR NEW."entityId" IS DISTINCT FROM OLD."entityId"
    OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
    OR NEW."archivedBy" IS DISTINCT FROM OLD."archivedBy"
  THEN
    NEW."version" := OLD."version" + 1;
    -- Prisma stamps updatedAt itself; a writer that did not (a referential
    -- action, raw SQL) gets the database's UTC clock, which is what Prisma's
    -- timestamp columns hold.
    IF NEW."updatedAt" = OLD."updatedAt" THEN
      NEW."updatedAt" := now() AT TIME ZONE 'UTC';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tasks_version_guard"
BEFORE UPDATE ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "tasks_version_guard"();
