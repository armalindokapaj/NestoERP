-- AUD-10 §3 (gap 13): a daily log's evidence link points at a canonical Document
-- of its own company, and at a daily log of its own company.
--
-- Before: daily_log_document_links had a FK to daily_logs(id) only — nothing
-- stopped a link naming a missing document, or a document or log of another
-- company. After: composite FKs (documentId, companyId) → documents(id, companyId)
-- and (dailyLogId, companyId) → daily_logs(id, companyId), both ON DELETE CASCADE:
-- the link is metadata about how a file sits in the day's evidence, and a
-- never-completed upload placeholder that the storage cleanup removes takes its
-- link with it instead of failing the cleanup. Nothing deletes a completed
-- document; its link is never removed by this migration.
--
-- Conflict check (PRD §10): rows that would violate either key are reported by
-- id and the migration stops. Nothing is deleted, repaired or re-pointed here.
--
-- Rollback (manual, safe at any time — it only drops constraints/indexes this
-- migration added):
--   ALTER TABLE "daily_log_document_links" DROP CONSTRAINT "daily_log_document_links_documentId_companyId_fkey";
--   ALTER TABLE "daily_log_document_links" DROP CONSTRAINT "daily_log_document_links_dailyLogId_companyId_fkey";
--   ALTER TABLE "daily_log_document_links" ADD CONSTRAINT "daily_log_document_links_dailyLogId_fkey"
--     FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   DROP INDEX "daily_log_document_links_documentId_companyId_idx";
--   DROP INDEX "daily_logs_id_companyId_key";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260927120000_daily_log_document_link_fks_aud_10';

DO $$
DECLARE
  orphans text;
BEGIN
  SELECT string_agg(format('%s/%s', l."dailyLogId", l."documentId"), ', ' ORDER BY l."dailyLogId", l."documentId")
    INTO orphans
    FROM (
      SELECT l."dailyLogId", l."documentId"
      FROM "daily_log_document_links" l
      LEFT JOIN "documents" d ON d."id" = l."documentId" AND d."companyId" = l."companyId"
      LEFT JOIN "daily_logs" g ON g."id" = l."dailyLogId" AND g."companyId" = l."companyId"
      WHERE d."id" IS NULL OR g."id" IS NULL
      LIMIT 200
    ) l;
  IF orphans IS NOT NULL THEN
    RAISE EXCEPTION 'AUD-10: daily_log_document_links rows point at a missing document or at a document/log of another company (dailyLogId/documentId): %. Review each: re-point it to the right document, or remove the link deliberately, then re-run the migration.', orphans;
  END IF;
END $$;

-- The target of the company-scoped key from the log's children.
CREATE UNIQUE INDEX "daily_logs_id_companyId_key" ON "daily_logs"("id", "companyId");

CREATE INDEX "daily_log_document_links_documentId_companyId_idx" ON "daily_log_document_links"("documentId", "companyId");

ALTER TABLE "daily_log_document_links" DROP CONSTRAINT "daily_log_document_links_dailyLogId_fkey";

ALTER TABLE "daily_log_document_links" ADD CONSTRAINT "daily_log_document_links_dailyLogId_companyId_fkey"
  FOREIGN KEY ("dailyLogId", "companyId") REFERENCES "daily_logs"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_log_document_links" ADD CONSTRAINT "daily_log_document_links_documentId_companyId_fkey"
  FOREIGN KEY ("documentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
