"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ZodError } from "zod";

import { approvalGuardFrom, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { committed } from "@/lib/forms/committed";
import { actionFailure } from "@/lib/actions/result";
import {
  invalidInput,
  readSubmittedLines,
  scalarFormValues,
  type SubmittedLines,
} from "@/lib/modules/finance/finance.form-data";
import { requireCompanyContext } from "@/lib/context/current-user";
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
  | { ok: true; id?: string; message?: string; redirectTo?: string }
  /** `code`: the refusal's stable code, e.g. APPROVAL_SOURCE_CHANGED (AUD-10 §4). */
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function revalidateFinance(path?: string) {
  revalidatePath("/finance", "layout");
  if (path) revalidatePath(path, "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/dashboard");
}

/**
 * A refusal the form can place (AUD-09 §3, §6): a service's field details as
 * `fieldErrors`, a uniqueness race as a business sentence, anything unexpected
 * as `INTERNAL_ERROR` — a confirmed failure, never mistaken for a field error.
 */
function toResult(error: unknown): FinanceActionResult {
  return actionFailure(error, "finance");
}

/**
 * Invalid input, every issue under its canonical path (`lineItems.2.quantity`),
 * each row's index being the one it was submitted as (AUD-09 §3, §7, FV-16).
 */
function invalid(error: ZodError, rows: SubmittedLines | null = null): FinanceActionResult {
  return invalidInput(error, rows ? { lineItems: rows.submitted } : {});
}

/** Repeated line fields, by their submitted index (see `readSubmittedLines`). */
function readLines(formData: FormData, prefix: string, fields: string[]): SubmittedLines {
  return readSubmittedLines(formData, prefix, fields);
}

function scalarValues(formData: FormData): Record<string, unknown> {
  return scalarFormValues(formData);
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
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

  const rows = readLines(formData, "lineItems", INVOICE_LINE_FIELDS);
  const parsed = createInvoiceSchema.safeParse({ ...scalarValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows);

  let id: string;
  try {
    id = (await invoices.createInvoice(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return committed(`/finance/invoices/${id}`);
}

export async function updateInvoiceAction(
  invoiceId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  const rows = readLines(formData, "lineItems", INVOICE_LINE_FIELDS);
  const parsed = updateInvoiceSchema.safeParse({ ...scalarValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows);

  try {
    await invoices.updateInvoice(context, invoiceId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/invoices/${invoiceId}`);
  return committed(`/finance/invoices/${invoiceId}`);
}

/*
 * Decisions name the approval cycle the page displayed (`cycle`), so a record
 * rejected and resubmitted since cannot be decided from the stale page: the
 * service refuses a missing cycle (428 APPROVAL_CYCLE_REQUIRED) and a replaced
 * one (409 APPROVAL_SOURCE_CHANGED) inside its transaction (AUD-10 §4, CW-02,
 * CW-05). Other lifecycle steps ignore it.
 */
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await invoices.submitInvoice(context, invoiceId);
    else if (action === "approve") await invoices.approveInvoice(context, invoiceId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    await invoices.rejectInvoice(context, invoiceId, reason, approvalGuardFrom(cycle));
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
  const context = await requireCompanyContext();

  const parsed = createExpenseSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await expenses.createExpense(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return committed(`/finance/expenses/${id}`);
}

export async function updateExpenseAction(
  expenseId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateExpenseSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await expenses.updateExpense(context, expenseId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/expenses/${expenseId}`);
  return committed(`/finance/expenses/${expenseId}`);
}

export type ExpenseAction = "submit" | "approve" | "cancel" | "archive" | "restore";

export async function expenseLifecycleAction(
  expenseId: string,
  action: ExpenseAction,
  note?: string,
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await expenses.submitExpense(context, expenseId);
    else if (action === "approve") await expenses.approveExpense(context, expenseId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    await expenses.rejectExpense(context, expenseId, reason, approvalGuardFrom(cycle));
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
  const context = await requireCompanyContext();

  const rows = readLines(formData, "lineItems", BUDGET_LINE_FIELDS);
  const parsed = createBudgetSchema.safeParse({ ...scalarValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows);

  let id: string;
  try {
    id = (await budgets.createBudget(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return committed(`/finance/budgets/${id}`);
}

export async function updateBudgetAction(
  budgetId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  const rows = readLines(formData, "lineItems", BUDGET_LINE_FIELDS);
  const parsed = updateBudgetSchema.safeParse({ ...scalarValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows);

  try {
    await budgets.updateBudget(context, budgetId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/budgets/${budgetId}`);
  return committed(`/finance/budgets/${budgetId}`);
}

export type BudgetAction = "submit" | "approve" | "archive" | "restore";

export async function budgetLifecycleAction(
  budgetId: string,
  action: BudgetAction,
  note?: string,
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await budgets.submitBudget(context, budgetId);
    else if (action === "approve") await budgets.approveBudget(context, budgetId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    await budgets.rejectBudget(context, budgetId, reason, approvalGuardFrom(cycle));
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/budgets/${budgetId}`);
  return { ok: true };
}

export async function reviseBudgetAction(budgetId: string): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

  const parsed = createCommitmentSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await commitments.createCommitment(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance();
  return committed(`/finance/commitments/${id}`);
}

export async function updateCommitmentAction(
  commitmentId: string,
  formData: FormData,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateCommitmentSchema.safeParse(scalarValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await commitments.updateCommitment(context, commitmentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateFinance(`/finance/commitments/${commitmentId}`);
  return committed(`/finance/commitments/${commitmentId}`);
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await commitments.submitCommitment(context, commitmentId);
    else if (action === "approve")
      await commitments.approveCommitment(context, commitmentId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

  try {
    await commitments.rejectCommitment(context, commitmentId, reason, approvalGuardFrom(cycle));
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
  const context = await requireCompanyContext();

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
  return committed(target);
}

export async function voidPaymentAction(
  paymentId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const context = await requireCompanyContext();

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
  const context = await requireCompanyContext();

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
