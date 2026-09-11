import { z } from "zod";

import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { optionalText } from "@/lib/modules/shared/fields";
import { currencyCode } from "./finance.fields";
import { DEFAULT_CURRENCY } from "./finance.currency";

/**
 * Company finance settings (PRD #15 §28, §394–§398).
 *
 * Read by almost every finance screen, so it is resolved through one function
 * that creates the row on first use rather than making every caller handle a
 * missing record.
 */

export const financeSettingsSchema = z.object({
  baseCurrency: currencyCode,
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  invoicePrefix: optionalText(20),
  defaultTaxRate: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()))
    .refine((value) => value === undefined || /^\d{1,3}(\.\d{1,4})?$/.test(value), {
      message: "Tax rate must be a number with at most 4 decimal places",
    })
    .refine((value) => value === undefined || Number.parseFloat(value) <= 100, {
      message: "Tax rate must be 100 or less",
    }),
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
 */
export async function resolveFinanceSettings(companyId: string): Promise<FinanceSettingsDTO> {
  const existing = await prisma.financeSettings.findUnique({ where: { companyId } });
  if (existing) return toDTO(existing);

  const created = await prisma.financeSettings.upsert({
    where: { companyId },
    update: {},
    create: { companyId, baseCurrency: DEFAULT_CURRENCY },
  });

  return toDTO(created);
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

  const updated = await prisma.financeSettings.upsert({
    where: { companyId: context.companyId },
    update: {
      baseCurrency: input.baseCurrency,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      invoicePrefix: input.invoicePrefix ?? null,
      defaultTaxRate: input.defaultTaxRate ?? null,
    },
    create: {
      companyId: context.companyId,
      baseCurrency: input.baseCurrency,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      invoicePrefix: input.invoicePrefix ?? null,
      defaultTaxRate: input.defaultTaxRate ?? null,
    },
  });

  return toDTO(updated);
}

/** Base currency alone, for the many callers that need only that. */
export async function baseCurrency(companyId: string): Promise<string> {
  const settings = await prisma.financeSettings.findUnique({
    where: { companyId },
    select: { baseCurrency: true },
  });
  return settings?.baseCurrency ?? DEFAULT_CURRENCY;
}

function toDTO(row: {
  baseCurrency: string;
  defaultPaymentTermsDays: number;
  fiscalYearStartMonth: number;
  invoicePrefix: string | null;
  defaultTaxRate: { toString(): string } | null;
}): FinanceSettingsDTO {
  return {
    baseCurrency: row.baseCurrency,
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    invoicePrefix: row.invoicePrefix,
    defaultTaxRate: row.defaultTaxRate?.toString() ?? null,
  };
}
