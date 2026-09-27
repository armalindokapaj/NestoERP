-- AUD-10 §4, §10, A6: at most one PENDING approval cycle per record, in every
-- approval table the Approvals Center reads that did not already enforce it.
-- Legal (contract_approvals), unit publishing, unit sales and document reviews
-- already have their own index; this mirrors contract_approvals_one_pending_per_record.
--
-- Two pending cycles on one record let a stale page or a race decide either of
-- them (the domain now refuses that as APPROVAL_CYCLE_AMBIGUOUS); the index makes
-- the second submission fail instead of existing.
--
-- Safety (PRD §10): nothing is deleted and no winner is picked. If any table
-- already holds two PENDING rows for one record, the migration stops before
-- creating any index and lists the offending approval ids per table. Remedy by
-- deciding or cancelling the extra cycle through its module (or, with the owner's
-- sign-off, marking the older one CANCELLED with an audit note), then re-run
-- `prisma migrate deploy`.
--
-- Rollback (no data change to undo):
--   DROP INDEX IF EXISTS "finance_approvals_one_pending_per_record";
--   DROP INDEX IF EXISTS "procurement_approvals_one_pending_per_record";
--   DROP INDEX IF EXISTS "sales_approvals_one_pending_per_record";
--   DROP INDEX IF EXISTS "quality_approvals_one_pending_per_record";
--   DROP INDEX IF EXISTS "hse_approvals_one_pending_per_record";
--   DROP INDEX IF EXISTS "timesheet_approvals_one_pending_per_record";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260927110000_one_pending_approval_per_record_aud_10';

DO $$
DECLARE
  report text := '';
  found text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_approvals', 'procurement_approvals', 'sales_approvals', 'quality_approvals', 'hse_approvals', 'timesheet_approvals'] LOOP
    EXECUTE format(
      'SELECT string_agg(format(''%%s %%s: %%s'', "recordType", "recordId", ids), ''; '')
         FROM (SELECT "recordType", "recordId", string_agg("id", '', '' ORDER BY "submittedAt", "id") AS ids
                 FROM %I WHERE "status" = ''PENDING''
                GROUP BY "recordType", "recordId" HAVING count(*) > 1) d',
      t
    ) INTO found;
    IF found IS NOT NULL THEN
      report := report || E'\n  ' || t || ' -> ' || found;
    END IF;
  END LOOP;
  IF report <> '' THEN
    RAISE EXCEPTION 'AUD-10 A6: records with more than one PENDING approval cycle; decide or cancel the extra cycles through their module, then re-run the migration. Nothing was changed.%', report;
  END IF;
END $$;

CREATE UNIQUE INDEX "finance_approvals_one_pending_per_record"
  ON "finance_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "procurement_approvals_one_pending_per_record"
  ON "procurement_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "sales_approvals_one_pending_per_record"
  ON "sales_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "quality_approvals_one_pending_per_record"
  ON "quality_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "hse_approvals_one_pending_per_record"
  ON "hse_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "timesheet_approvals_one_pending_per_record"
  ON "timesheet_approvals" ("recordType", "recordId") WHERE "status" = 'PENDING';
