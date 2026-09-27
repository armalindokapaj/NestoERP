import { z } from "zod";

import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { isPositiveDecimal } from "../finance.decimal";
import { MAX_LINE_ITEMS } from "../finance.form-data";
import { amountString, clearableText, currencyCode } from "../finance.fields";
import { EXPENSE_CATEGORIES } from "../expenses/expense.schema";

/**
 * Budget validation (PRD #15 §241).
 *
 * `version`, `isCurrent` and `totalAmount` are absent: the version is assigned
 * by the service, `isCurrent` is decided at approval, and the total is the sum
 * of the lines (PRD #15 §107, §109, §113).
 */
export const budgetLineSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { message: "Choose a category" }),
  description: requiredText(1, 500, "Line description"),
  // Required: the editor starts every line at 0, and an emptied amount is a
  // mistake to point at, not a zero to store (AUD-09 §4, FV-06). Zero itself is
  // a legitimate plan for one line of several.
  plannedAmount: amountString("Planned amount"),
});

export type BudgetLineInput = z.infer<typeof budgetLineSchema>;

const budgetFields = {
  projectId: z.string().trim().min(1, "Choose a project"),
  name: optionalText(160),
  currency: currencyCode,
  notes: optionalText(2000),
  lineItems: z
    .array(budgetLineSchema)
    .min(1, "Add at least one budget line")
    .max(MAX_LINE_ITEMS, `A budget can have at most ${MAX_LINE_ITEMS} lines`),
};

/** A budget of zero is not a budget (PRD #15 §241). */
const hasRealMoney = <T extends { lineItems: { plannedAmount: string }[] }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) => value.lineItems.some((line) => isPositiveDecimal(line.plannedAmount)),
    { message: "At least one line must have a planned amount.", path: ["lineItems"] },
  );

export const createBudgetSchema = hasRealMoney(z.object(budgetFields));
export const updateBudgetSchema = hasRealMoney(
  z.object({
    ...budgetFields,
    // The project never moves once a budget exists: a budget belongs to the
    // project it was drawn for (PRD #15 §103).
    projectId: z.string().trim().min(1),
    // Absent keeps, empty or null clears (AUD-09 §4, FV-05).
    name: clearableText(160),
    notes: clearableText(2000),
    versionUpdatedAt: optionalDate,
  }),
);

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const BUDGET_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;

export const BUDGET_SORT_KEYS = [
  "updated-desc",
  "project-asc",
  "amount-desc",
  "amount-asc",
  "version-desc",
] as const;

export type BudgetSortKey = (typeof BUDGET_SORT_KEYS)[number];

export const budgetListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(BUDGET_STATUSES)).optional(),
  projectId: z.string().optional(),
  currency: z.string().optional(),
  currentOnly: z.boolean().default(false),
  archived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(BUDGET_SORT_KEYS).default("updated-desc"),
});

export type BudgetListQuery = z.infer<typeof budgetListQuerySchema>;
