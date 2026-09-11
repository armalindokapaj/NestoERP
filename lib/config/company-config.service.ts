import type { ModuleKey } from "@/config/modules";
import { prisma } from "@/lib/database/prisma";

import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { ensureIntegrationSettings } from "@/lib/modules/settings/integration-settings.service";

/**
 * Runtime company configuration (PRD #24 §138-§143, §324-§326).
 *
 * One resolver that answers "how is this company configured", cached against
 * `Company.configVersion` so a settings change takes effect on the next request
 * without anybody logging out (PRD #24 §164, §319).
 *
 * Only non-sensitive values belong here. Authorisation still comes from
 * UserContext — a module being enabled is not permission to use it
 * (PRD #24 §140, §7).
 */

export type CompanyRuntimeConfig = {
  company: { id: string; name: string; country: string | null };
  localization: { locale: string; timezone: string; dateFormat: string };
  finance: {
    baseCurrency: string;
    fiscalYearStartMonth: number;
    defaultPaymentTermsDays: number;
  };
  modules: Partial<Record<ModuleKey, { enabled: boolean }>>;
  integrations: {
    qualityGateForInventoryReceipts: boolean;
    autoCreateFinanceCommitmentFromApprovedPo: boolean;
  };
  configVersion: number;
};

const cache = new Map<string, { version: number; value: CompanyRuntimeConfig }>();

/**
 * Cache failure is never a security decision: a miss re-reads the database
 * rather than assuming anything (PRD #31 §115, §231).
 */
export async function getCompanyRuntimeConfig(companyId: string): Promise<CompanyRuntimeConfig> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, country: true, configVersion: true },
  });
  if (!company) throw new Error("COMPANY_NOT_FOUND");

  const hit = cache.get(companyId);
  if (hit && hit.version === company.configVersion) return hit.value;

  const [settings, integrations, companyModules] = await Promise.all([
    ensureCompanySettings(companyId),
    ensureIntegrationSettings(companyId),
    prisma.companyModule.findMany({
      where: { companyId },
      select: { enabled: true, module: { select: { key: true } } },
    }),
  ]);

  const modules: Partial<Record<ModuleKey, { enabled: boolean }>> = {};
  for (const row of companyModules) {
    modules[row.module.key as ModuleKey] = { enabled: row.enabled };
  }

  const value: CompanyRuntimeConfig = {
    company: { id: company.id, name: company.name, country: company.country },
    localization: {
      locale: settings.locale,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
    },
    finance: {
      baseCurrency: settings.baseCurrency,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
      defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    },
    modules,
    integrations: {
      qualityGateForInventoryReceipts: integrations.qualityGateForInventoryReceipts,
      autoCreateFinanceCommitmentFromApprovedPo: integrations.autoCreateFinanceCommitmentFromApprovedPo,
    },
    configVersion: company.configVersion,
  };

  cache.set(companyId, { version: company.configVersion, value });
  return value;
}

/** Bumping the version is what invalidates every cached copy (PRD #24 §164). */
export async function invalidateCompanyConfig(companyId: string): Promise<void> {
  cache.delete(companyId);
  await prisma.company.update({
    where: { id: companyId },
    data: { configVersion: { increment: 1 } },
  });
}

/**
 * Creates the configuration a new company needs, idempotently, so a retried
 * onboarding does not produce duplicates (PRD #24 §309, §310).
 */
export async function bootstrapCompanyConfiguration(companyId: string): Promise<void> {
  const { NUMBERING_DEFAULTS } = await import("@/lib/core/numbering/numbering.service");

  await ensureCompanySettings(companyId);
  await ensureIntegrationSettings(companyId);

  await prisma.companyNumberingScheme.createMany({
    data: NUMBERING_DEFAULTS.map((d) => ({
      companyId,
      moduleKey: d.moduleKey,
      entityType: d.entityType,
      prefix: d.prefix,
    })),
    skipDuplicates: true,
  });
}
