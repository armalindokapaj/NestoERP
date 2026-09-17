import { Prisma } from "@prisma/client";
import { z } from "zod";

import { can } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
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

/**
 * The finance half of company settings (PRD #24 §15, §17, PRD #47 §61).
 *
 * Base currency, tax and payment terms are read by every money-handling module,
 * so they sit behind `company.finance_settings.*` rather than the ordinary
 * settings grant: an Admin or IT administrator configures the company's
 * locale without acquiring its ledger defaults.
 */
export const COMPANY_FINANCE_FIELDS = [
  "baseCurrency",
  "fiscalYearStartMonth",
  "defaultPaymentTermsDays",
  "defaultTaxRate",
] as const;

/**
 * A finance field left out of the input is unchanged, so somebody without the
 * finance grant can still save the localisation half of the form.
 */
export const companySettingsSchema = z.object({
  locale: z.string().regex(BCP47, "Use a language tag such as en or de-DE"),
  timezone: z.string().regex(IANA_TIMEZONE, "Use an IANA timezone such as Europe/Tirane"),
  dateFormat: z.enum(DATE_FORMATS),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter ISO 4217 code")
    .optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(3650).optional(),
  /** Absent is unchanged; an empty value clears the rate. */
  defaultTaxRate: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim()))
    .refine((v) => v == null || /^\d{1,3}(\.\d{1,4})?$/.test(v), "Use a number with at most 4 decimals")
    .refine((v) => v == null || Number.parseFloat(v) <= 100, "Tax rate must be 100 or less"),
});

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

/** The whole of company settings, as a reader holding the finance grant sees it. */
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

type CompanyFinanceField = (typeof COMPANY_FINANCE_FIELDS)[number];

/**
 * What `getCompanySettings` answers (PRD #47 §61).
 *
 * Without `company.finance_settings.view` the finance fields are simply absent,
 * and `financeVisible` says so — a reader is never handed a placeholder
 * currency that looks like the company's real one.
 */
export type CompanySettingsView =
  | (CompanySettingsDTO & { financeVisible: true })
  | (Omit<CompanySettingsDTO, CompanyFinanceField> & { financeVisible: false });

/** Creates the row on first read so no caller has to handle a missing record. */
export async function ensureCompanySettings(companyId: string) {
  const existing = await prisma.companySettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  try {
    return await prisma.companySettings.create({ data: { companyId } });
  } catch (error) {
    // Two first reads at once: the other one created it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.companySettings.findUniqueOrThrow({ where: { companyId } });
    }
    throw error;
  }
}

export async function getCompanySettings(context: UserContext): Promise<CompanySettingsView> {
  assertPermission(context, "company.settings.view");
  const row = await ensureCompanySettings(context.companyId);
  const localisation = {
    locale: row.locale,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    updatedAt: row.updatedAt.toISOString(),
  };

  if (!can(context, "company.finance_settings.view")) {
    return { ...localisation, financeVisible: false };
  }

  return { ...localisation, ...financeValues(row), financeVisible: true };
}

type CompanySettingsRow = Awaited<ReturnType<typeof ensureCompanySettings>>;

function financeValues(row: CompanySettingsRow): Pick<CompanySettingsDTO, CompanyFinanceField> {
  return {
    baseCurrency: row.baseCurrency,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    defaultTaxRate: row.defaultTaxRate?.toString() ?? null,
  };
}

/**
 * The finance fields this input would actually change.
 *
 * Compared with the stored values rather than inferred from presence, so a
 * form that round-trips the unchanged defaults is not refused for touching
 * something it did not change. Tax rates compare as numbers: "20" and "20.00"
 * are the same rate.
 */
function changedFinanceFields(
  input: CompanySettingsInput,
  current: Pick<CompanySettingsDTO, CompanyFinanceField>,
): CompanyFinanceField[] {
  const changed: CompanyFinanceField[] = [];
  if (input.baseCurrency !== undefined && input.baseCurrency !== current.baseCurrency) changed.push("baseCurrency");
  if (input.fiscalYearStartMonth !== undefined && input.fiscalYearStartMonth !== current.fiscalYearStartMonth) {
    changed.push("fiscalYearStartMonth");
  }
  if (input.defaultPaymentTermsDays !== undefined && input.defaultPaymentTermsDays !== current.defaultPaymentTermsDays) {
    changed.push("defaultPaymentTermsDays");
  }
  if (input.defaultTaxRate !== undefined) {
    const next = input.defaultTaxRate === null ? null : Number.parseFloat(input.defaultTaxRate);
    const now = current.defaultTaxRate === null ? null : Number.parseFloat(current.defaultTaxRate);
    if (next !== now) changed.push("defaultTaxRate");
  }
  return changed;
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

/**
 * The company-scoped settings write, and the configuration bump that goes with
 * it (PRD #48 §106).
 *
 * `CompanySettings` is Settings' row. Finance owns some of the values on it —
 * base currency, payment terms, the fiscal year — and writes them through
 * here so the `configVersion` bump that invalidates every cache keyed off
 * company configuration cannot be forgotten by one caller and remembered by
 * another (PRD #24 §315-§317).
 */
export async function writeCompanySettings(
  tx: Prisma.TransactionClient,
  companyId: string,
  memberId: string | null,
  data: Prisma.CompanySettingsUpdateInput,
): Promise<void> {
  await tx.companySettings.update({
    where: { companyId },
    data: { ...data, ...(memberId ? { updatedByMemberId: memberId } : {}) },
  });
  await tx.company.update({ where: { id: companyId }, data: { configVersion: { increment: 1 } } });
}

export async function updateCompanySettings(
  context: UserContext,
  input: CompanySettingsInput,
): Promise<CompanySettingsView> {
  assertPermission(context, "company.settings.update");
  const current = await ensureCompanySettings(context.companyId);
  const currentFinance = financeValues(current);

  // Changing a finance default is the finance grant's decision, whoever else
  // may edit the rest of the page (PRD #24 §15, PRD #47 §61). Checked before
  // the currency lock, so the lock's state is not disclosed to somebody who
  // could not change the currency anyway.
  const financeChanged = changedFinanceFields(input, currentFinance);
  if (financeChanged.length > 0) assertPermission(context, "company.finance_settings.manage");

  const currencyChanged = financeChanged.includes("baseCurrency");
  if (currencyChanged && (await baseCurrencyLocked(context.companyId))) {
    throw new AccessError(
      "CONFLICT",
      "Base currency cannot be changed after financial records have been created.",
      { code: "BASE_CURRENCY_LOCKED" },
    );
  }

  // Only the fields this input carries are written, and only those enter the
  // audit snapshot, so a localisation-only save records no finance "change".
  const written = {
    locale: input.locale,
    timezone: input.timezone,
    dateFormat: input.dateFormat,
    ...(input.baseCurrency === undefined ? {} : { baseCurrency: input.baseCurrency }),
    ...(input.fiscalYearStartMonth === undefined ? {} : { fiscalYearStartMonth: input.fiscalYearStartMonth }),
    ...(input.defaultPaymentTermsDays === undefined ? {} : { defaultPaymentTermsDays: input.defaultPaymentTermsDays }),
    ...(input.defaultTaxRate === undefined ? {} : { defaultTaxRate: input.defaultTaxRate }),
  };
  const auditedKeys = Object.keys(written).filter((key) => key !== "baseCurrency") as Array<
    Exclude<keyof typeof written, "baseCurrency">
  >;
  const currentValues: Record<string, unknown> = {
    locale: current.locale,
    timezone: current.timezone,
    dateFormat: current.dateFormat,
    ...currentFinance,
  };

  await prisma.$transaction(async (tx) => {
    await writeCompanySettings(tx, context.companyId, context.membershipId, written);

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMPANY_SETTINGS_UPDATED,
        entity: { type: "company_settings", id: context.companyId },
        before: Object.fromEntries(auditedKeys.map((key) => [key, currentValues[key]])),
        after: Object.fromEntries(auditedKeys.map((key) => [key, written[key]])),
      },
      { tx },
    );

    // Currency and timezone carry their own, louder keys because they
    // reinterpret money and dates respectively (PRD #28 §98, §101).
    if (currencyChanged) {
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
