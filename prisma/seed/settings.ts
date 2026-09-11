import type { PrismaClient } from "@prisma/client";

import { NUMBERING_DEFAULTS } from "../../lib/core/numbering/numbering.service";

/**
 * Company configuration seed (PRD #24 §257-§263, §309-§312).
 *
 * Company A is the construction demo: everything on, auto numbering where it
 * makes the demo read well. Company B is deliberately different — another
 * locale, a different module mix, manual numbering — so every cross-company and
 * module-availability test has a genuine contrast to assert against
 * (PRD #24 §259, §263).
 */
export async function seedCompanySettings(
  prisma: PrismaClient,
  companies: { companyA: { id: string }; companyB: { id: string } },
) {
  const { companyA, companyB } = companies;

  await prisma.companySettings.upsert({
    where: { companyId: companyA.id },
    update: {},
    create: {
      companyId: companyA.id,
      locale: "en",
      timezone: "Europe/Tirane",
      dateFormat: "DD/MM/YYYY",
      baseCurrency: "EUR",
      fiscalYearStartMonth: 1,
      defaultPaymentTermsDays: 30,
    },
  });

  await prisma.companySettings.upsert({
    where: { companyId: companyB.id },
    update: {},
    create: {
      companyId: companyB.id,
      locale: "de-DE",
      timezone: "Europe/Berlin",
      dateFormat: "YYYY-MM-DD",
      baseCurrency: "EUR",
      fiscalYearStartMonth: 4,
      defaultPaymentTermsDays: 14,
    },
  });

  await prisma.companyIntegrationSettings.upsert({
    where: { companyId: companyA.id },
    update: {},
    create: {
      companyId: companyA.id,
      qualityGateForInventoryReceipts: true,
      autoCreateFinanceCommitmentFromApprovedPo: true,
    },
  });

  // Company B has Procurement, Inventory and QA off, so neither integration can
  // be on — the blocker path the settings UI has to explain (PRD #24 §225).
  await prisma.companyIntegrationSettings.upsert({
    where: { companyId: companyB.id },
    update: {},
    create: {
      companyId: companyB.id,
      qualityGateForInventoryReceipts: false,
      autoCreateFinanceCommitmentFromApprovedPo: false,
    },
  });

  const AUTO_FOR_A = new Set([
    "finance:invoice",
    "finance:expense",
    "sales:proposal",
    "procurement:purchase_order",
    "procurement:goods_receipt",
    "qaqc:ncr",
    "hse:incident",
  ]);

  for (const scheme of NUMBERING_DEFAULTS) {
    const key = `${scheme.moduleKey}:${scheme.entityType}`;
    await prisma.companyNumberingScheme.upsert({
      where: {
        companyId_moduleKey_entityType: {
          companyId: companyA.id,
          moduleKey: scheme.moduleKey,
          entityType: scheme.entityType,
        },
      },
      update: {},
      create: {
        companyId: companyA.id,
        moduleKey: scheme.moduleKey,
        entityType: scheme.entityType,
        prefix: scheme.prefix,
        mode: AUTO_FOR_A.has(key) ? "AUTO" : "MANUAL",
      },
    });

    await prisma.companyNumberingScheme.upsert({
      where: {
        companyId_moduleKey_entityType: {
          companyId: companyB.id,
          moduleKey: scheme.moduleKey,
          entityType: scheme.entityType,
        },
      },
      update: {},
      create: {
        companyId: companyB.id,
        moduleKey: scheme.moduleKey,
        entityType: scheme.entityType,
        prefix: scheme.prefix,
        mode: "MANUAL",
      },
    });
  }

  return { seeded: true };
}
