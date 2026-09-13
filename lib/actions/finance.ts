"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import * as payments from "@/lib/modules/finance/payments/payment.service";
import {
  financeSettingsSchema,
  updateFinanceSettings,
} from "@/lib/modules/finance/finance.settings";
import { createBudgetSchema, updateBudgetSchema } from "@/lib/modules/finance/budgets/budget.schema";
import {
  createCommitmentSchema,
  updateCommitmentSchema,
} from "@/lib/modules/finance/commitments/commitment.schema";
import {
  createExpenseSchema,
  updateExpenseSchema,
} from "@/lib/modules/finance/expenses/expense.schema";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
} from "@/lib/modules/finance/invoices/invoice.schema";
import {
  createPaymentSchema,
  voidPaymentSchema,
} from "@/lib/modules/finance/payments/payment.schema";

/**
 * Server actions for the Finance module (PRD #15 §218).
 *
 * A thin shell over the same services the API routes call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type FinanceActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function revalidateFinance(path?: string) {
  revalidatePath("/finance", "layout");
  if (path) revalidatePath(path, "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): FinanceActionResult {
  if (error instanceof AccessError) return { ok: false, error: error.message };
  console.error("[finance] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): FinanceActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * Reads a form that carries repeated line fields.
 *
 * Line inputs are named `lineItems[0].description` and so on, which is how a
 * plain HTML form expresses a list. They are collected by index rather than by
 * position in the FormData, so a removed row cannot shift the rest.
 */
function readLines(formData: FormData, prefix: string, fields: string[]) {
  const byIndex = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    const match = key.match(new RegExp(`^${prefix}\\[(\\d+)\\]\\.(\\w+)$`));
    if (!match || typeof value !== "string") continue;

    const index = Number.parseInt(match[1], 10);
    const field = match[2];
    if (!fields.includes(field)) continue;

    const line = byIndex.get(index) ?? {};
    line[field] = value;
    byIndex.set(index, line);
  }

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, line]) => line)
    // A row somebody cleared out is dropped rather than failing validation.
    .filter((line) => fields.some((field) => (line[field] ?? "").trim() !== ""));
}

function scalarValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.includes("[")) values[key] = value;
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

const INVOICE_LINE_FIELDS = ["description", "quantity", "unitPrice", "taxRate"];

/**
 * Raising an invoice from an accepted proposal (PRD #35 §180).
 *
 * No form: everything comes from the proposal, which is the point — the
 * figures are snapshotted from what the client accepted rather than retyped.
 * The invoice opens as a draft, so anything that does need changing is changed
 * before it is submitted.
 */
export async function invoiceFromProposalAction(
  proposalId: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  let id: string;
  try {
    id = (await invoices.createInvoiceFromProposal(context, proposalId)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/invoices/${id}`);
}

export async function createInvoiceAction(formData: FormData): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = createInvoiceSchema.safeParse({
    ...scalarValues(formData),
    lineItems: readLines(formData, "lineItems", INVOICE_LINE_FIELDS),
  });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await invoices.createInvoice(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/invoices/${id}`);
}

export async function updateInvoiceAction(
  invoiceId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = updateInvoiceSchema.safeParse({
    ...scalarValues(formData),
    lineItems: readLines(formData, "lineItems", INVOICE_LINE_FIELDS),
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await invoices.updateInvoice(context, invoiceId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/invoices/${invoiceId}`);
  redirect(`/finance/invoices/${invoiceId}`);
}

export type InvoiceAction =
  | "submit"
  | "approve"
  | "mark-sent"
  | "cancel"
  | "archive"
  | "restore";

export async function invoiceLifecycleAction(
  invoiceId: string,
  action: InvoiceAction,
  note?: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "submit") await invoices.submitInvoice(context, invoiceId);
    else if (action === "approve") await invoices.approveInvoice(context, invoiceId, note ?? null);
    else if (action === "mark-sent") await invoices.markInvoiceSent(context, invoiceId);
    else if (action === "cancel") await invoices.cancelInvoice(context, invoiceId);
    else if (action === "archive") await invoices.archiveInvoice(context, invoiceId);
    else await invoices.restoreInvoice(context, invoiceId);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/invoices/${invoiceId}`);
  return { ok: true };
}

export async function rejectInvoiceAction(
  invoiceId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    await invoices.rejectInvoice(context, invoiceId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/invoices/${invoiceId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export async function createExpenseAction(formData: FormData): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = createExpenseSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await expenses.createExpense(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/expenses/${id}`);
}

export async function updateExpenseAction(
  expenseId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = updateExpenseSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await expenses.updateExpense(context, expenseId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/expenses/${expenseId}`);
  redirect(`/finance/expenses/${expenseId}`);
}

export type ExpenseAction = "submit" | "approve" | "cancel" | "archive" | "restore";

export async function expenseLifecycleAction(
  expenseId: string,
  action: ExpenseAction,
  note?: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "submit") await expenses.submitExpense(context, expenseId);
    else if (action === "approve") await expenses.approveExpense(context, expenseId, note ?? null);
    else if (action === "cancel") await expenses.cancelExpense(context, expenseId);
    else if (action === "archive") await expenses.archiveExpense(context, expenseId);
    else await expenses.restoreExpense(context, expenseId);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/expenses/${expenseId}`);
  return { ok: true };
}

export async function rejectExpenseAction(
  expenseId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    await expenses.rejectExpense(context, expenseId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/expenses/${expenseId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Budgets                                                                     */
/* -------------------------------------------------------------------------- */

const BUDGET_LINE_FIELDS = ["category", "description", "plannedAmount"];

export async function createBudgetAction(formData: FormData): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = createBudgetSchema.safeParse({
    ...scalarValues(formData),
    lineItems: readLines(formData, "lineItems", BUDGET_LINE_FIELDS),
  });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await budgets.createBudget(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/budgets/${id}`);
}

export async function updateBudgetAction(
  budgetId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = updateBudgetSchema.safeParse({
    ...scalarValues(formData),
    lineItems: readLines(formData, "lineItems", BUDGET_LINE_FIELDS),
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await budgets.updateBudget(context, budgetId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/budgets/${budgetId}`);
  redirect(`/finance/budgets/${budgetId}`);
}

export type BudgetAction = "submit" | "approve" | "archive" | "restore";

export async function budgetLifecycleAction(
  budgetId: string,
  action: BudgetAction,
  note?: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "submit") await budgets.submitBudget(context, budgetId);
    else if (action === "approve") await budgets.approveBudget(context, budgetId, note ?? null);
    else if (action === "archive") await budgets.archiveBudget(context, budgetId);
    else await budgets.restoreBudget(context, budgetId);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/budgets/${budgetId}`);
  return { ok: true };
}

export async function rejectBudgetAction(
  budgetId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    await budgets.rejectBudget(context, budgetId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/budgets/${budgetId}`);
  return { ok: true };
}

export async function reviseBudgetAction(budgetId: string): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  let id: string;
  try {
    id = await budgets.reviseBudget(context, budgetId);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/budgets/${id}/edit`);
}

/* -------------------------------------------------------------------------- */
/* Commitments                                                                 */
/* -------------------------------------------------------------------------- */

export async function createCommitmentAction(formData: FormData): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = createCommitmentSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await commitments.createCommitment(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  redirect(`/finance/commitments/${id}`);
}

export async function updateCommitmentAction(
  commitmentId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = updateCommitmentSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await commitments.updateCommitment(context, commitmentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/commitments/${commitmentId}`);
  redirect(`/finance/commitments/${commitmentId}`);
}

export type CommitmentAction =
  | "submit"
  | "approve"
  | "close"
  | "cancel"
  | "archive"
  | "restore";

export async function commitmentLifecycleAction(
  commitmentId: string,
  action: CommitmentAction,
  note?: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    if (action === "submit") await commitments.submitCommitment(context, commitmentId);
    else if (action === "approve")
      await commitments.approveCommitment(context, commitmentId, note ?? null);
    else if (action === "close") await commitments.closeCommitment(context, commitmentId);
    else if (action === "cancel") await commitments.cancelCommitment(context, commitmentId);
    else if (action === "archive") await commitments.archiveCommitment(context, commitmentId);
    else await commitments.restoreCommitment(context, commitmentId);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/commitments/${commitmentId}`);
  return { ok: true };
}

export async function rejectCommitmentAction(
  commitmentId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  try {
    await commitments.rejectCommitment(context, commitmentId, reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/commitments/${commitmentId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export async function recordPaymentAction(formData: FormData): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = createPaymentSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await payments.recordPayment(context, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  const target = parsed.data.invoiceId
    ? `/finance/invoices/${parsed.data.invoiceId}`
    : `/finance/expenses/${parsed.data.expenseId}`;
  revalidateFinance(target);
  redirect(target);
}

export async function voidPaymentAction(
  paymentId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = voidPaymentSchema.safeParse({ reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await payments.voidPayment(context, paymentId, parsed.data.reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateFinanceSettingsAction(
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireUserContext();

  const parsed = financeSettingsSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await updateFinanceSettings(context, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return { ok: true, message: "Finance settings saved." };
}
