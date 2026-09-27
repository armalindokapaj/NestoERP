import { z } from "zod";

import { optionalDate, optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { isPositiveDecimal, sumDecimal } from "../finance.decimal";
import {
  amountString,
  businessDate,
  clearableDecimalString,
  clearableId,
  clearableText,
  currencyCode,
  MONEY_RULE,
  optionalAmountValue,
} from "../finance.fields";

/** Expense validation (PRD #15 §239). */
export const EXPENSE_CATEGORIES = [
  "LABOR",
  "MATERIALS",
  "EQUIPMENT",
  "SUBCONTRACTOR",
  "SERVICES",
  "TRAVEL",
  "ADMINISTRATION",
  "OTHER",
] as const;

const expenseFields = {
  expenseNumber: optionalText(60),
  projectId: optionalId,
  expenseDate: businessDate,
  category: z.enum(EXPENSE_CATEGORIES, { message: "Choose a category" }),
  description: requiredText(2, 500, "Description"),
  payeeName: optionalText(250),
  currency: currencyCode,
  // The form marks net as required, and so does the server: an empty net
  // amount is refused, never read as zero (AUD-09 §4, FV-04, FV-06).
  netAmount: amountString("Net amount"),
  // Tax is optional, and the domain says what "no tax" is: a tax of zero — the
  // column is not nullable and an untaxed cost has tax 0. So empty is 0 here,
  // by rule rather than by a generic empty-becomes-zero parser.
  taxAmount: optionalAmountValue("Tax amount").transform((value) => value ?? "0"),
  notes: optionalText(2000),
};

/**
 * Net and tax may each be zero, but the total may not: an expense for nothing
 * is a data-entry accident, not a cost (PRD #15 §92).
 */
export const EXPENSE_TOTAL_MESSAGE = "The expense total must be greater than zero.";

export function expenseTotalIsPositive(netAmount: string, taxAmount: string): boolean {
  return isPositiveDecimal(sumDecimal([netAmount, taxAmount], 2));
}

const totalIsPositive = <T extends { netAmount: string; taxAmount?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    // An update that leaves tax out keeps the saved tax; the service checks
    // that total once it has read it.
    (value) => value.taxAmount === undefined || expenseTotalIsPositive(value.netAmount, value.taxAmount),
    { message: EXPENSE_TOTAL_MESSAGE, path: ["netAmount"] },
  );

export const createExpenseSchema = totalIsPositive(z.object(expenseFields));

/**
 * An edit sends the expense's core fields as on create; the optional ones
 * follow the partial-update rule (AUD-09 §4, FV-05): absent keeps what is
 * saved, empty or `null` clears — and for tax, clearing means "no tax" (0).
 */
export const updateExpenseSchema = totalIsPositive(
  z.object({
    ...expenseFields,
    expenseNumber: clearableText(60),
    projectId: clearableId,
    payeeName: clearableText(250),
    notes: clearableText(2000),
    taxAmount: clearableDecimalString("Tax amount", MONEY_RULE).transform((value) => (value === null ? "0" : value)),
    versionUpdatedAt: optionalDate,
  }),
);

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const EXPENSE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const EXPENSE_SETTLEMENTS = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;

export const EXPENSE_SORT_KEYS = [
  "date-desc",
  "date-asc",
  "amount-desc",
  "amount-asc",
  "updated-desc",
] as const;

export type ExpenseSortKey = (typeof EXPENSE_SORT_KEYS)[number];

export const expenseListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.array(z.enum(EXPENSE_STATUSES)).optional(),
    settlement: z.array(z.enum(EXPENSE_SETTLEMENTS)).optional(),
    category: z.array(z.enum(EXPENSE_CATEGORIES)).optional(),
    projectId: z.string().optional(),
    currency: z.string().optional(),
    incurredFrom: optionalDate,
    incurredTo: optionalDate,
    archived: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(25),
    sort: z.enum(EXPENSE_SORT_KEYS).default("date-desc"),
  })
  // Refused rather than answered with an empty list that looks like a result (AUD-01 §5.1).
  .refine((query) => !query.incurredFrom || !query.incurredTo || query.incurredFrom.getTime() <= query.incurredTo.getTime(), {
    message: "The date range ends before it starts.",
    path: ["incurredTo"],
  });

export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
