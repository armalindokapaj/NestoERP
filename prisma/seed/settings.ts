import type { PrismaClient } from "@prisma/client";

import { NUMBERING_DEFAULTS } from "../../lib/core/numbering/numbering.service";
import { DEMO_COMPANY_IDS, FIXTURE_TENANT, FIXTURE_WORKS } from "./constants";

/**
 * Company configuration seed (PRD #24 §257-§263, §309-§312).
 *
 * The five demo companies are the construction demo: everything on, auto
 * numbering where it makes the demo read well. The fixture tenant is
 * deliberately different — another locale, a different module mix, manual
 * numbering — so every cross-company and module-availability test has a
 * genuine contrast to assert against (PRD #24 §259, §263; E-06 §46).
 */
export async function seedCompanySettings(prisma: PrismaClient) {
  for (const companyId of [...DEMO_COMPANY_IDS, FIXTURE_WORKS]) {
    await seedConstructionCompany(prisma, companyId);
  }
  await seedFixtureTenant(prisma, FIXTURE_TENANT);
  return { seeded: true };
}

const AUTO_NUMBERED = new Set([
  "finance:invoice",
  "finance:expense",
  "sales:proposal",
  "procurement:purchase_order",
  "procurement:goods_receipt",
  "qaqc:ncr",
  "hse:incident",
]);

async function seedConstructionCompany(prisma: PrismaClient, companyId: string) {
  await prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      locale: "en",
      timezone: "Europe/Tirane",
      dateFormat: "DD/MM/YYYY",
      baseCurrency: "EUR",
      fiscalYearStartMonth: 1,
      defaultPaymentTermsDays: 30,
    },
  });

  await prisma.companyIntegrationSettings.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      qualityGateForInventoryReceipts: true,
      autoCreateFinanceCommitmentFromApprovedPo: true,
    },
  });

  for (const scheme of NUMBERING_DEFAULTS) {
    const key = `${scheme.moduleKey}:${scheme.entityType}`;
    await prisma.companyNumberingScheme.upsert({
      where: { companyId_moduleKey_entityType: { companyId, moduleKey: scheme.moduleKey, entityType: scheme.entityType } },
      update: {},
      create: {
        companyId,
        moduleKey: scheme.moduleKey,
        entityType: scheme.entityType,
        prefix: scheme.prefix,
        mode: AUTO_NUMBERED.has(key) ? "AUTO" : "MANUAL",
      },
    });
  }
}

async function seedFixtureTenant(prisma: PrismaClient, companyId: string) {
  await prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      locale: "de-DE",
      timezone: "Europe/Berlin",
      dateFormat: "YYYY-MM-DD",
      baseCurrency: "EUR",
      fiscalYearStartMonth: 4,
      defaultPaymentTermsDays: 14,
    },
  });

  // The tenant has Procurement, Inventory and QA off, so neither integration
  // can be on — the blocker path the settings UI has to explain (PRD #24 §225).
  await prisma.companyIntegrationSettings.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      qualityGateForInventoryReceipts: false,
      autoCreateFinanceCommitmentFromApprovedPo: false,
    },
  });

  for (const scheme of NUMBERING_DEFAULTS) {
    await prisma.companyNumberingScheme.upsert({
      where: { companyId_moduleKey_entityType: { companyId, moduleKey: scheme.moduleKey, entityType: scheme.entityType } },
      update: {},
      create: {
        companyId,
        moduleKey: scheme.moduleKey,
        entityType: scheme.entityType,
        prefix: scheme.prefix,
        mode: "MANUAL",
      },
    });
  }
}
