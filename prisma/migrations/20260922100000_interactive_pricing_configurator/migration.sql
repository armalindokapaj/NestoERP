CREATE TYPE "PricingVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "PricingPromotionStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PricingQuoteStatus" AS ENUM ('CALCULATED', 'LEAD_SUBMITTED', 'PROPOSAL_REQUESTED', 'EXPIRED', 'CONVERTED');
CREATE TYPE "PricingLeadRequestType" AS ENUM ('FORMAL_PROPOSAL', 'TALK_TO_SALES', 'THREE_D_PRODUCTION');
CREATE TYPE "PricingAuditAction" AS ENUM ('PRICE_VERSION_CREATED', 'PRICE_VERSION_UPDATED', 'PRICE_VERSION_PUBLISHED', 'PRICE_VERSION_RETIRED', 'PROMOTION_CREATED', 'PROMOTION_UPDATED', 'QUOTE_CALCULATED', 'QUOTE_LEAD_SUBMITTED');

CREATE TABLE "pricing_versions" (
    "id" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "PricingVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "configJson" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_promotions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PricingPromotionStatus" NOT NULL DEFAULT 'INACTIVE',
    "configJson" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_quotes" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "pricingVersionId" TEXT NOT NULL,
    "pricingVersionCode" TEXT NOT NULL,
    "productMode" TEXT NOT NULL,
    "configurationJson" JSONB NOT NULL,
    "calculatedResultJson" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "standardMonthlyCents" BIGINT NOT NULL,
    "contractMonths" INTEGER NOT NULL,
    "preIndexationValueCents" BIGINT NOT NULL,
    "promotionCode" TEXT,
    "status" "PricingQuoteStatus" NOT NULL DEFAULT 'CALCULATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_leads" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "requestType" "PricingLeadRequestType" NOT NULL DEFAULT 'FORMAL_PROPOSAL',
    "fullName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "businessEmail" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "PricingAuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "pricingVersion" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pricing_versions_versionCode_key" ON "pricing_versions"("versionCode");
CREATE INDEX "pricing_versions_status_effectiveFrom_idx" ON "pricing_versions"("status", "effectiveFrom");
CREATE UNIQUE INDEX "pricing_promotions_code_key" ON "pricing_promotions"("code");
CREATE INDEX "pricing_promotions_status_startsAt_endsAt_idx" ON "pricing_promotions"("status", "startsAt", "endsAt");
CREATE UNIQUE INDEX "pricing_quotes_reference_key" ON "pricing_quotes"("reference");
CREATE INDEX "pricing_quotes_pricingVersionCode_createdAt_idx" ON "pricing_quotes"("pricingVersionCode", "createdAt");
CREATE INDEX "pricing_quotes_status_expiresAt_idx" ON "pricing_quotes"("status", "expiresAt");
CREATE INDEX "pricing_leads_quoteId_createdAt_idx" ON "pricing_leads"("quoteId", "createdAt");
CREATE INDEX "pricing_leads_businessEmail_createdAt_idx" ON "pricing_leads"("businessEmail", "createdAt");
CREATE INDEX "pricing_audit_logs_entityType_entityId_createdAt_idx" ON "pricing_audit_logs"("entityType", "entityId", "createdAt");
CREATE INDEX "pricing_audit_logs_action_createdAt_idx" ON "pricing_audit_logs"("action", "createdAt");

ALTER TABLE "pricing_quotes" ADD CONSTRAINT "pricing_quotes_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_leads" ADD CONSTRAINT "pricing_leads_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "pricing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "pricing_versions" (
    "id", "versionCode", "currency", "status", "configJson", "effectiveFrom", "createdAt", "updatedAt", "publishedAt"
) VALUES (
    'pricing-version-2026-09',
    '2026.09',
    'EUR',
    'ACTIVE',
    '{"version":"2026.09","currency":"EUR","nestoERP":{"baseMonthlyCents":250000,"includedCompanies":1,"includedProjects":1,"includedUsersPerFullCompany":15,"additionalGroupCompanyMonthlyCents":25000,"additionalJVCompanyMonthlyCents":25000,"documentsOnlyCompanyMonthlyCents":10000,"additionalProjectMonthlyCents":25000,"userPackSize":10,"userPackMonthlyCents":35000},"rozaris":{"projectTypes":{"basic":{"monthly24Cents":65000,"monthly12Cents":130000},"large":{"monthly24Cents":130000,"monthly12Cents":260000},"village":{"monthly24Cents":260000,"monthly12Cents":520000}}},"indexation":{"enabled":true,"source":"EUROSTAT_HICP_EURO_AREA_ALL_ITEMS","floorPercent":0,"capPercent":5,"firstAdjustmentMonth":13}}'::jsonb,
    '2026-09-22T00:00:00.000Z',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "pricing_promotions" (
    "id", "code", "name", "status", "configJson", "createdAt", "updatedAt"
) VALUES (
    'pricing-promotion-nesto-launch-24',
    'NESTO_LAUNCH_24',
    'NESTO ERP launch offer',
    'ACTIVE',
    '{"code":"NESTO_LAUNCH_24","enabled":true,"product":"NESTO_ERP","requiredContractMonths":24,"periods":[{"months":3,"discountPercent":100},{"months":3,"discountPercent":50}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
