-- Admin Modules PRD #4: plans, company entitlements and per-module overrides.

CREATE TYPE "EntitlementPlanStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "ModuleEntitlementMode" AS ENUM ('ENABLED', 'DISABLED', 'TRIAL');

CREATE TABLE "entitlement_plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EntitlementPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "moduleKeys" TEXT[],
    "maxActiveUsers" INTEGER,
    "maxProjects" INTEGER,
    "maxStorageBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entitlement_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entitlement_plans_key_key" ON "entitlement_plans"("key");

CREATE TABLE "company_entitlements" (
    "companyId" TEXT NOT NULL,
    "planId" TEXT,
    "maxActiveUsers" INTEGER,
    "maxProjects" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_entitlements_pkey" PRIMARY KEY ("companyId")
);
CREATE INDEX "company_entitlements_planId_idx" ON "company_entitlements"("planId");

CREATE TABLE "company_module_entitlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "mode" "ModuleEntitlementMode" NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_module_entitlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_module_entitlements_companyId_moduleKey_key" ON "company_module_entitlements"("companyId", "moduleKey");
CREATE INDEX "company_module_entitlements_moduleKey_idx" ON "company_module_entitlements"("moduleKey");

ALTER TABLE "company_entitlements" ADD CONSTRAINT "company_entitlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_entitlements" ADD CONSTRAINT "company_entitlements_planId_fkey" FOREIGN KEY ("planId") REFERENCES "entitlement_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_module_entitlements" ADD CONSTRAINT "company_module_entitlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company_entitlements"("companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The starting plans (§24, §45, §46). Core modules are always granted and are not listed.
INSERT INTO "entitlement_plans" ("id", "key", "name", "description", "moduleKeys", "updatedAt") VALUES
  ('plan_full', 'full', 'Full NESTO', 'Every NESTO module.', ARRAY['projects','tasks','meetings','timesheets','dailyLogs','workforce','contractors','engineering','clients','documents','finance','hr','sales','contracts','procurement','inventory','qaqc','hse'], now() AT TIME ZONE 'UTC'),
  ('plan_rozaris', 'rozaris', 'Rozaris', 'Projects, units, sales and contracts for developers selling through Rozaris.', ARRAY['projects','tasks','clients','documents','sales','contracts'], now() AT TIME ZONE 'UTC'),
  ('plan_documents', 'documents', 'Documents Only', 'Core NESTO and Documents.', ARRAY['documents'], now() AT TIME ZONE 'UTC');

-- Existing companies keep everything they could use (§86, §87): each holds Full NESTO.
INSERT INTO "company_entitlements" ("companyId", "planId", "updatedAt")
SELECT "id", 'plan_full', now() AT TIME ZONE 'UTC' FROM "companies"
ON CONFLICT DO NOTHING;
