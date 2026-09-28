-- ADM audit §2: a group reaches ACTIVE only through the activation checklist,
-- and activatedAt is the record of that handover. Groups that are ACTIVE today
-- without one predate the rule; they were handed over, so record it.
-- Groups not ACTIVE now keep a null and must pass the checklist.
UPDATE "parent_groups" SET "activatedAt" = "createdAt" WHERE "status" = 'ACTIVE' AND "activatedAt" IS NULL;
