import { toCsv } from "@/lib/utils/csv";
import { expenseCategoryLabels, expenseStatusLabels } from "./expenses/expense.status";
import type { ExpenseSummaryDTO, InvoiceSummaryDTO, WithCompany } from "./finance.types";
import { invoiceStatusLabels, settlementLabels } from "./invoices/invoice.status";

/**
 * The registers' CSV files (AUD-01 §8).
 *
 * Built from the register's own rows, so a file can only ever hold what the
 * list shows — the same records, order, amounts and settlement — plus the
 * company and record ids that tell apart two companies' identical numbers.
 * Nothing the list does not show goes in: no notes, no bank details, no
 * payments. Amounts are the API's decimal strings, ungrouped; dates are the
 * business dates; statuses are their labels; an empty optional value is an
 * empty cell.
 *
 * UTF-8 with a byte-order mark and CRLF line endings, so Excel opens Albanian
 * names correctly and every spreadsheet agrees where a row ends. Each text cell
 * goes through `csvCell`, which keeps a formula-looking name a name.
 */

export const INVOICE_EXPORT_COLUMNS = [
  "Company ID",
  "Company",
  "Invoice ID",
  "Invoice number",
  "Client",
  "Project code",
  "Project",
  "Issue date",
  "Due date",
  "Currency",
  "Workflow status",
  "Settlement",
  "Total",
  "Paid",
  "Outstanding",
] as const;

export const EXPENSE_EXPORT_COLUMNS = [
  "Company ID",
  "Company",
  "Expense ID",
  "Expense number",
  "Payee",
  "Project code",
  "Project",
  "Expense date",
  "Category",
  "Currency",
  "Workflow status",
  "Settlement",
  "Total",
  "Paid",
  "Outstanding",
] as const;

type Cell = string | null | undefined;

function csvDocument(headers: readonly string[], rows: Cell[][]): string {
  return `﻿${toCsv(headers, rows, { lineBreak: "\r\n" })}\r\n`;
}

export function invoiceCsv(rows: ReadonlyArray<WithCompany<InvoiceSummaryDTO>>): string {
  return csvDocument(
    INVOICE_EXPORT_COLUMNS,
    rows.map((row) => [
      row.company.id,
      row.company.name,
      row.id,
      row.invoiceNumber,
      row.client.name,
      row.project?.code,
      row.project?.name,
      row.issueDate,
      row.dueDate,
      row.currency,
      invoiceStatusLabels[row.status],
      settlementLabels[row.settlementStatus],
      row.totalAmount,
      row.paidAmount,
      row.outstandingAmount,
    ]),
  );
}

export function expenseCsv(rows: ReadonlyArray<WithCompany<ExpenseSummaryDTO>>): string {
  return csvDocument(
    EXPENSE_EXPORT_COLUMNS,
    rows.map((row) => [
      row.company.id,
      row.company.name,
      row.id,
      row.expenseNumber,
      row.payeeName,
      row.project?.code,
      row.project?.name,
      row.expenseDate,
      expenseCategoryLabels[row.category],
      row.currency,
      expenseStatusLabels[row.status],
      settlementLabels[row.settlementStatus],
      row.totalAmount,
      row.paidAmount,
      row.outstandingAmount,
    ]),
  );
}
