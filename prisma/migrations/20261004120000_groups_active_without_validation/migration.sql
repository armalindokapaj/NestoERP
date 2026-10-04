-- A group is ACTIVE from creation: the Ready-for-validation and activation steps are gone.
-- IMPLEMENTING / READY_FOR_VALIDATION stay in the enum (nothing produces them any more); live rows move to ACTIVE.
UPDATE "ParentGroup"
SET "status" = 'ACTIVE',
    "activatedAt" = COALESCE("activatedAt", now() AT TIME ZONE 'UTC')
WHERE "status" IN ('IMPLEMENTING', 'READY_FOR_VALIDATION');
