-- Reference links are written by one service now, with one key format
-- (PRD #48 §64, §65). Daily logs and milestone links were each built by their
-- own module and left out the source's entity type, so the same relationship
-- had two possible keys depending on which module wrote it.
--
-- The new key is the old key with the source entity type in front, so this is
-- a rename rather than a rebuild. Without it, re-linking a pair that is already
-- linked would miss the existing row and leave two rows for one relationship.
--
-- The NOT LIKE guard makes this safe to apply to a database where some rows
-- already carry the prefix.
UPDATE "integration_links"
   SET "idempotencyKey" = "sourceEntityType" || ':' || "idempotencyKey"
 WHERE "integrationType" IN ('DAILY_LOG_RECORD', 'MILESTONE_RECORD')
   AND "idempotencyKey" NOT LIKE "sourceEntityType" || ':%';
