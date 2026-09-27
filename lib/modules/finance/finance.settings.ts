import { z } from "zod";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { compareDecimal } from "./finance.decimal";
import { clearableDecimalString, clearableText, currencyCode, TAX_RATE_RULE, wholeNumber } from "./finance.fields";
import { DEFAULT_CURRENCY } from "./finance.currency";
import { todayInTimeZone } from "@/lib/forms/dates";
import { writeCompanySettings } from "@/lib/modules/settings/company-settings.service";

/**
 * Company finance settings (PRD #15 §28, §394–§398).
 *
 * Read by almost every finance screen, so it is resolved through one function
 * that creates the row on first use rather than making every caller handle a
 * missing record.
 */

/**
 * The settings form always sends every field; the PATCH route may not
 * (AUD-09 §4, FV-05). Terms and fiscal month are whole numbers — an empty field
 * is refused rather than read as 0 — and the two optional finance-only fields
 * keep what is saved when absent and clear when sent empty.
 */
export const financeSettingsSchema = z.object({
  baseCurrency: currencyCode,
  defaultPaymentTermsDays: wholeNumber("Payment terms", 0, 365),
  fiscalYearStartMonth: wholeNumber("Fiscal year start month", 1, 12),
  invoicePrefix: clearableText(20),
  defaultTaxRate: clearableDecimalString("Default tax rate", TAX_RATE_RULE).refine(
    (value) => value === undefined || value === null || compareDecimal(value, "100") <= 0,
    { message: "Tax rate must be 100 or less" },
  ),
});

export type FinanceSettingsInput = z.infer<typeof financeSettingsSchema>;

export type FinanceSettingsDTO = {
  baseCurrency: string;
  defaultPaymentTermsDays: number;
  fiscalYearStartMonth: number;
  invoicePrefix: string | null;
  defaultTaxRate: string | null;
};

/**
 * The company's finance settings, created on first read.
 *
 * No permission check: this is configuration every finance screen needs in
 * order to render an amount at all, and the screens themselves are guarded.
 * Reading it never reveals a monetary value.
 *
 * Base currency, fiscal year and payment terms are company-wide and come from
 * CompanySettings — Finance owns only what is genuinely finance-specific, so a
 * company has one answer to "what currency are we in" (PRD #24 §41-§43, §124).
 */
export async function resolveFinanceSettings(companyId: string): Promise<FinanceSettingsDTO> {
  const [company, finance] = await Promise.all([
    ensureCompanySettings(companyId),
    prisma.financeSettings.upsert({
      where: { companyId },
      update: {},
      create: { companyId },
    }),
  ]);

  return {
    baseCurrency: company.baseCurrency,
    defaultPaymentTermsDays: company.defaultPaymentTermsDays,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    invoicePrefix: finance.invoicePrefix,
    defaultTaxRate: (finance.defaultTaxRate ?? company.defaultTaxRate)?.toString() ?? null,
  };
}

export async function getFinanceSettings(context: UserContext): Promise<FinanceSettingsDTO> {
  assertModule(context, "finance");
  assertPermission(context, "finance.settings.view");
  return resolveFinanceSettings(context.companyId);
}

export async function updateFinanceSettings(
  context: UserContext,
  input: FinanceSettingsInput,
): Promise<FinanceSettingsDTO> {
  assertModule(context, "finance");
  assertPermission(context, "finance.settings.manage");

  // The company-wide half is written through to CompanySettings, which owns it.
  // Base currency is refused once monetary records exist, because there is no
  // FX engine to reinterpret them with (PRD #24 §185-§189).
  const company = await ensureCompanySettings(context.companyId);
  if (input.baseCurrency !== company.baseCurrency) {
    const { baseCurrencyLocked } = await import("@/lib/modules/settings/company-settings.service");
    // A refusal the person can act on, beside the field — not a bare Error
    // answered as "couldn't save" (AUD-09 §3).
    if (await baseCurrencyLocked(context.companyId)) {
      const message = "Base currency cannot be changed after financial records have been created.";
      throw new AccessError("CONFLICT", message, { code: "BASE_CURRENCY_LOCKED", baseCurrency: [message] });
    }
  }

  await prisma.$transaction(async (tx) => {
    // The company-wide half, and the configuration bump that goes with it,
    // through the module that owns them (PRD #48 §106).
    await writeCompanySettings(tx, context.companyId, context.membershipId, {
      baseCurrency: input.baseCurrency,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
    });
    await tx.financeSettings.upsert({
      where: { companyId: context.companyId },
      // Absent keeps what is saved; empty clears (FV-05).
      update: {
        invoicePrefix: input.invoicePrefix,
        defaultTaxRate: input.defaultTaxRate,
      },
      create: {
        companyId: context.companyId,
        invoicePrefix: input.invoicePrefix ?? null,
        defaultTaxRate: input.defaultTaxRate ?? null,
      },
    });
  });

  return resolveFinanceSettings(context.companyId);
}

/** Base currency alone, for the many callers that need only that. */
export async function baseCurrency(companyId: string): Promise<string> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { baseCurrency: true },
  });
  return settings?.baseCurrency ?? DEFAULT_CURRENCY;
}

/**
 * Today's calendar date for the company (AUD-09 §4, FV-07): the default a date
 * field opens on. `new Date().toISOString()` is the UTC day, which is
 * yesterday for a company in Tirane just after midnight.
 */
export async function companyToday(companyId: string, now: Date = new Date()): Promise<string> {
  const company = await ensureCompanySettings(companyId);
  return todayInTimeZone(company.timezone || "UTC", now);
}
