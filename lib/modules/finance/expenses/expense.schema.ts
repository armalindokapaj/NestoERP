import { z } from "zod";

import { optionalDate, optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { businessDate, currencyCode, optionalAmountString } from "../finance.fields";

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
  netAmount: optionalAmountString("Net amount"),
  taxAmount: optionalAmountString("Tax amount"),
  notes: optionalText(2000),
};

/**
 * Net and tax may each be zero, but the total may not: an expense for nothing
 * is a data-entry accident, not a cost (PRD #15 §92).
 */
const totalIsPositive = <T extends { netAmount: string; taxAmount: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) => Number.parseFloat(value.netAmount) + Number.parseFloat(value.taxAmount) > 0,
    { message: "The expense total must be greater than zero.", path: ["netAmount"] },
  );

export const createExpenseSchema = totalIsPositive(z.object(expenseFields));
export const updateExpenseSchema = totalIsPositive(
  z.object({ ...expenseFields, versionUpdatedAt: optionalDate }),
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

export const expenseListQuerySchema = z.object({
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
});

export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
