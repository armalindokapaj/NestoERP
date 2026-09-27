import { serializeRows, type CsvLayout, type ExportColumn } from "@/lib/core/export/exporter";
import type { ParamRules } from "@/lib/core/export/export-params";
import { EXPENSE_CATEGORIES, EXPENSE_SETTLEMENTS, EXPENSE_SORT_KEYS, EXPENSE_STATUSES } from "./expenses/expense.schema";
import { expenseCategoryLabels, expenseStatusLabels } from "./expenses/expense.status";
import type { ExpenseSummaryDTO, InvoiceSummaryDTO, WithCompany } from "./finance.types";
import { INVOICE_SORT_KEYS, INVOICE_STATUSES, SETTLEMENT_FILTERS } from "./invoices/invoice.schema";
import { invoiceStatusLabels, settlementLabels } from "./invoices/invoice.status";

/**
 * The registers' CSV files (AUD-01 §8; AUD-08 §7).
 *
 * Built from the register's own rows, so a file can only ever hold what the
 * list shows — the same records, order, amounts and settlement — plus the
 * company and record ids that tell apart two companies' identical numbers.
 * Nothing the list does not show goes in: no notes, no bank details, no
 * payments. Amounts are the API's decimal strings, ungrouped, in columns the
 * shared exporter writes as numbers (a payee typed `-120.50` is still text and
 * guarded); dates are the business dates; statuses are their labels; an empty
 * optional value is an empty cell.
 *
 * UTF-8 with a byte-order mark and CRLF line endings, the last row ended too,
 * so Excel opens Albanian names correctly and every spreadsheet agrees where a
 * row ends. The read, its snapshot and its 10,000-row cap are AUD-01's
 * (`finance.register.ts`); the response goes through the shared exporter's
 * byte cap and headers.
 */

/**
 * The register filters an export accepts — the list's own vocabulary; anything
 * else, or a value the list would drop, is refused before the read (AUD-08 §3,
 * DT-03). `company` narrows a Group export; one the reader cannot export from
 * yields no rows (AUD-01 FA-13), never every company.
 */
const REGISTER_PARAMS: ParamRules = {
  search: { kind: "text" },
  company: { kind: "id" },
  projectId: { kind: "id" },
  currency: { kind: "text", max: 8 },
  archived: { kind: "flag" },
};

export const INVOICE_EXPORT_PARAMS: ParamRules = {
  ...REGISTER_PARAMS,
  status: { kind: "enumList", allowed: INVOICE_STATUSES, caseInsensitive: true },
  settlement: { kind: "enumList", allowed: SETTLEMENT_FILTERS, caseInsensitive: true },
  clientId: { kind: "id" },
  issuedFrom: { kind: "date" },
  issuedTo: { kind: "date" },
  sort: { kind: "enum", allowed: INVOICE_SORT_KEYS },
};

export const EXPENSE_EXPORT_PARAMS: ParamRules = {
  ...REGISTER_PARAMS,
  status: { kind: "enumList", allowed: EXPENSE_STATUSES, caseInsensitive: true },
  settlement: { kind: "enumList", allowed: EXPENSE_SETTLEMENTS, caseInsensitive: true },
  category: { kind: "enumList", allowed: EXPENSE_CATEGORIES, caseInsensitive: true },
  incurredFrom: { kind: "date" },
  incurredTo: { kind: "date" },
  sort: { kind: "enum", allowed: EXPENSE_SORT_KEYS },
};

const LAYOUT: CsvLayout = { lineBreak: "\r\n", trailingLineBreak: true };

type InvoiceRow = WithCompany<InvoiceSummaryDTO>;
type ExpenseRow = WithCompany<ExpenseSummaryDTO>;

export const INVOICE_COLUMNS: ReadonlyArray<ExportColumn<InvoiceRow>> = [
  { header: "Company ID", kind: "code", value: (row) => row.company.id },
  { header: "Company", kind: "text", value: (row) => row.company.name },
  { header: "Invoice ID", kind: "code", value: (row) => row.id },
  { header: "Invoice number", kind: "code", value: (row) => row.invoiceNumber },
  { header: "Client", kind: "text", value: (row) => row.client.name },
  { header: "Project code", kind: "code", value: (row) => row.project?.code },
  { header: "Project", kind: "text", value: (row) => row.project?.name },
  { header: "Issue date", kind: "date", value: (row) => row.issueDate },
  { header: "Due date", kind: "date", value: (row) => row.dueDate },
  { header: "Currency", kind: "code", value: (row) => row.currency },
  { header: "Workflow status", kind: "status", value: (row) => invoiceStatusLabels[row.status] },
  { header: "Settlement", kind: "status", value: (row) => settlementLabels[row.settlementStatus] },
  { header: "Total", kind: "decimal", value: (row) => row.totalAmount },
  { header: "Paid", kind: "decimal", value: (row) => row.paidAmount },
  { header: "Outstanding", kind: "decimal", value: (row) => row.outstandingAmount },
];

export const EXPENSE_COLUMNS: ReadonlyArray<ExportColumn<ExpenseRow>> = [
  { header: "Company ID", kind: "code", value: (row) => row.company.id },
  { header: "Company", kind: "text", value: (row) => row.company.name },
  { header: "Expense ID", kind: "code", value: (row) => row.id },
  { header: "Expense number", kind: "code", value: (row) => row.expenseNumber },
  { header: "Payee", kind: "text", value: (row) => row.payeeName },
  { header: "Project code", kind: "code", value: (row) => row.project?.code },
  { header: "Project", kind: "text", value: (row) => row.project?.name },
  { header: "Expense date", kind: "date", value: (row) => row.expenseDate },
  { header: "Category", kind: "status", value: (row) => expenseCategoryLabels[row.category] },
  { header: "Currency", kind: "code", value: (row) => row.currency },
  { header: "Workflow status", kind: "status", value: (row) => expenseStatusLabels[row.status] },
  { header: "Settlement", kind: "status", value: (row) => settlementLabels[row.settlementStatus] },
  { header: "Total", kind: "decimal", value: (row) => row.totalAmount },
  { header: "Paid", kind: "decimal", value: (row) => row.paidAmount },
  { header: "Outstanding", kind: "decimal", value: (row) => row.outstandingAmount },
];

export const INVOICE_EXPORT_COLUMNS = INVOICE_COLUMNS.map((column) => column.header);
export const EXPENSE_EXPORT_COLUMNS = EXPENSE_COLUMNS.map((column) => column.header);

/** The file's text, without the byte-order mark (the response adds it). */
export function invoiceCsv(rows: ReadonlyArray<InvoiceRow>): string {
  return serializeRows(INVOICE_COLUMNS, rows, LAYOUT);
}

export function expenseCsv(rows: ReadonlyArray<ExpenseRow>): string {
  return serializeRows(EXPENSE_COLUMNS, rows, LAYOUT);
}
