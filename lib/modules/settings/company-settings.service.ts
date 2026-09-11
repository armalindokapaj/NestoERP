import { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";

/**
 * Company settings (PRD #24 §19-§43, PRD #37 §24).
 *
 * The canonical home for locale, timezone, base currency and fiscal defaults.
 * FinanceSettings keeps only what is genuinely finance-specific and reads the
 * rest from here, so a company has one answer to "what currency are we in"
 * (PRD #24 §40-§43).
 *
 * Nothing here grants access. Enabling a module does not authorise a user, and
 * changing a default never rewrites a historical record (PRD #24 §7, §194).
 */

const IANA_TIMEZONE = /^[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$|^UTC$/;
const BCP47 = /^[a-z]{2}(-[A-Z]{2})?$/;

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

export const companySettingsSchema = z.object({
  locale: z.string().regex(BCP47, "Use a language tag such as en or de-DE"),
  timezone: z.string().regex(IANA_TIMEZONE, "Use an IANA timezone such as Europe/Tirane"),
  dateFormat: z.enum(DATE_FORMATS),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter ISO 4217 code"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(3650),
  defaultTaxRate: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || /^\d{1,3}(\.\d{1,4})?$/.test(v), "Use a number with at most 4 decimals")
    .refine((v) => v === null || Number.parseFloat(v) <= 100, "Tax rate must be 100 or less"),
});

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

export type CompanySettingsDTO = {
  locale: string;
  timezone: string;
  dateFormat: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  defaultPaymentTermsDays: number;
  defaultTaxRate: string | null;
  updatedAt: string;
};

/** Creates the row on first read so no caller has to handle a missing record. */
export async function ensureCompanySettings(companyId: string) {
  const existing = await prisma.companySettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  return prisma.companySettings.upsert({
    where: { companyId },
    create: { companyId },
    update: {},
  });
}

export async function getCompanySettings(context: UserContext): Promise<CompanySettingsDTO> {
  assertPermission(context, "company.settings.view");
  const row = await ensureCompanySettings(context.companyId);
  return {
    locale: row.locale,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    baseCurrency: row.baseCurrency,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    defaultTaxRate: row.defaultTaxRate?.toString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Base currency is locked once money exists (PRD #24 §185-§189).
 *
 * There is no FX engine, so changing the base currency after invoices, expenses,
 * payments, budgets or commitments have been recorded would silently reinterpret
 * every existing amount.
 */
export async function baseCurrencyLocked(companyId: string): Promise<boolean> {
  const [invoices, expenses, payments, budgets, commitments] = await Promise.all([
    prisma.invoice.count({ where: { companyId } }),
    prisma.expense.count({ where: { companyId } }),
    prisma.payment.count({ where: { companyId } }),
    prisma.projectBudget.count({ where: { companyId } }),
    prisma.commitment.count({ where: { companyId } }),
  ]);
  return invoices + expenses + payments + budgets + commitments > 0;
}

export async function updateCompanySettings(
  context: UserContext,
  input: CompanySettingsInput,
): Promise<CompanySettingsDTO> {
  assertPermission(context, "company.settings.update");
  const current = await ensureCompanySettings(context.companyId);

  if (input.baseCurrency !== current.baseCurrency && (await baseCurrencyLocked(context.companyId))) {
    throw new Error("BASE_CURRENCY_LOCKED");
  }

  await prisma.$transaction(async (tx) => {
    await tx.companySettings.update({
      where: { companyId: context.companyId },
      data: { ...input, updatedByMemberId: context.membershipId },
    });
    // Anything caching company configuration keys off this (PRD #24 §315-§317).
    await tx.company.update({
      where: { id: context.companyId },
      data: { configVersion: { increment: 1 } },
    });

    const before = {
      locale: current.locale,
      timezone: current.timezone,
      dateFormat: current.dateFormat,
      fiscalYearStartMonth: current.fiscalYearStartMonth,
      defaultPaymentTermsDays: current.defaultPaymentTermsDays,
      defaultTaxRate: current.defaultTaxRate?.toString() ?? null,
    };

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMPANY_SETTINGS_UPDATED,
        entity: { type: "company_settings", id: context.companyId },
        before,
        after: { ...input, defaultTaxRate: input.defaultTaxRate ?? null },
      },
      { tx },
    );

    // Currency and timezone carry their own, louder keys because they
    // reinterpret money and dates respectively (PRD #28 §98, §101).
    if (input.baseCurrency !== current.baseCurrency) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.COMPANY_BASE_CURRENCY_CHANGED,
          entity: { type: "company_settings", id: context.companyId },
          before: { baseCurrency: current.baseCurrency },
          after: { baseCurrency: input.baseCurrency },
        },
        { tx },
      );
    }
    if (input.timezone !== current.timezone) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.COMPANY_TIMEZONE_CHANGED,
          entity: { type: "company_settings", id: context.companyId },
          before: { timezone: current.timezone },
          after: { timezone: input.timezone },
        },
        { tx },
      );
    }
  });

  return getCompanySettings(context);
}
