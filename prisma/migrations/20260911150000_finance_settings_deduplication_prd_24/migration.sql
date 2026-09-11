-- CompanySettings takes over the company-wide finance defaults (PRD #24 §41-§43, §124).
--
-- FinanceSettings held baseCurrency, fiscalYearStartMonth and
-- defaultPaymentTermsDays alongside CompanySettings, which meant a company could
-- hold two different answers to the same question. CompanySettings owns them now.
--
-- Backfill first, then contract: any company that already had finance settings
-- keeps its values, and a company already configured through CompanySettings is
-- left alone (PRD #37 §182 expand-and-contract, §181 backfill before contract).

INSERT INTO "company_settings" (
  "id", "companyId", "locale", "timezone", "dateFormat",
  "baseCurrency", "fiscalYearStartMonth", "defaultPaymentTermsDays", "defaultTaxRate",
  "createdAt", "updatedAt"
)
SELECT
  'cs_' || md5(fs."companyId"),
  fs."companyId",
  'en',
  'UTC',
  'DD/MM/YYYY',
  fs."baseCurrency",
  fs."fiscalYearStartMonth",
  fs."defaultPaymentTermsDays",
  fs."defaultTaxRate",
  NOW(),
  NOW()
FROM "finance_settings" fs
ON CONFLICT ("companyId") DO NOTHING;

ALTER TABLE "finance_settings"
  DROP COLUMN "baseCurrency",
  DROP COLUMN "defaultPaymentTermsDays",
  DROP COLUMN "fiscalYearStartMonth";
