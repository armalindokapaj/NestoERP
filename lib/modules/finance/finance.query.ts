import { firstValue } from "@/lib/modules/shared/list-query";
import {
  INVOICE_SORT_KEYS,
  INVOICE_STATUSES,
  SETTLEMENT_FILTERS,
  invoiceListQuerySchema,
  type InvoiceListQuery,
} from "./invoices/invoice.schema";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SETTLEMENTS,
  EXPENSE_SORT_KEYS,
  EXPENSE_STATUSES,
  expenseListQuerySchema,
  type ExpenseListQuery,
} from "./expenses/expense.schema";
import {
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_SORT_KEYS,
  PAYMENT_STATUSES,
  paymentListQuerySchema,
  type PaymentListQuery,
} from "./payments/payment.schema";
import {
  BUDGET_SORT_KEYS,
  BUDGET_STATUSES,
  budgetListQuerySchema,
  type BudgetListQuery,
} from "./budgets/budget.schema";
import {
  COMMITMENT_SORT_KEYS,
  COMMITMENT_STATUSES,
  commitmentListQuerySchema,
  type CommitmentListQuery,
} from "./commitments/commitment.schema";

/**
 * URL search parameters → validated list queries (PRD #15 §243).
 *
 * Shared by the pages and the API, so `/finance/invoices?status=SENT` and
 * `GET /api/finance/invoices?status=SENT` behave identically. An unknown sort
 * key or status is dropped rather than rejected: a stale bookmark should show
 * the list, not an error page.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

function sortKey<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function page(params: RawParams): number {
  const value = Number.parseInt(read(params, "page") ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function limit(params: RawParams): number {
  const value = Number.parseInt(read(params, "limit") ?? "25", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : 25;
}

function flag(params: RawParams, key: string): boolean {
  const value = read(params, key);
  return value === "1" || value === "true";
}

function date(params: RawParams, key: string): string | undefined {
  const value = read(params, key);
  return value && value.trim() !== "" ? value : undefined;
}

export type InvoiceQueryDefaults = Partial<
  Pick<InvoiceListQuery, "status" | "settlement" | "sort" | "archived">
>;

export function parseInvoiceQuery(
  params: RawParams,
  defaults: InvoiceQueryDefaults = {},
): InvoiceListQuery {
  return invoiceListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), INVOICE_STATUSES) ?? defaults.status,
    settlement: list(read(params, "settlement"), SETTLEMENT_FILTERS) ?? defaults.settlement,
    clientId: read(params, "clientId") || undefined,
    projectId: read(params, "projectId") || undefined,
    currency: read(params, "currency") || undefined,
    issuedFrom: date(params, "issuedFrom"),
    issuedTo: date(params, "issuedTo"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), INVOICE_SORT_KEYS, defaults.sort ?? "issue-desc"),
  });
}

export type ExpenseQueryDefaults = Partial<
  Pick<ExpenseListQuery, "status" | "settlement" | "sort" | "archived">
>;

export function parseExpenseQuery(
  params: RawParams,
  defaults: ExpenseQueryDefaults = {},
): ExpenseListQuery {
  return expenseListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), EXPENSE_STATUSES) ?? defaults.status,
    settlement: list(read(params, "settlement"), EXPENSE_SETTLEMENTS) ?? defaults.settlement,
    category: list(read(params, "category"), EXPENSE_CATEGORIES),
    projectId: read(params, "projectId") || undefined,
    currency: read(params, "currency") || undefined,
    incurredFrom: date(params, "incurredFrom"),
    incurredTo: date(params, "incurredTo"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), EXPENSE_SORT_KEYS, defaults.sort ?? "date-desc"),
  });
}

export function parsePaymentQuery(params: RawParams): PaymentListQuery {
  return paymentListQuerySchema.parse({
    search: read(params, "search") || undefined,
    direction: list(read(params, "direction"), PAYMENT_DIRECTIONS),
    status: list(read(params, "status"), PAYMENT_STATUSES),
    method: list(read(params, "method"), PAYMENT_METHODS),
    invoiceId: read(params, "invoiceId") || undefined,
    expenseId: read(params, "expenseId") || undefined,
    currency: read(params, "currency") || undefined,
    paidFrom: date(params, "paidFrom"),
    paidTo: date(params, "paidTo"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), PAYMENT_SORT_KEYS, "date-desc"),
  });
}

export type BudgetQueryDefaults = Partial<
  Pick<BudgetListQuery, "status" | "sort" | "archived" | "currentOnly">
>;

export function parseBudgetQuery(
  params: RawParams,
  defaults: BudgetQueryDefaults = {},
): BudgetListQuery {
  return budgetListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), BUDGET_STATUSES) ?? defaults.status,
    projectId: read(params, "projectId") || undefined,
    currency: read(params, "currency") || undefined,
    currentOnly: defaults.currentOnly ?? flag(params, "current"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), BUDGET_SORT_KEYS, defaults.sort ?? "updated-desc"),
  });
}

export type CommitmentQueryDefaults = Partial<
  Pick<CommitmentListQuery, "status" | "sort" | "archived" | "openOnly">
>;

export function parseCommitmentQuery(
  params: RawParams,
  defaults: CommitmentQueryDefaults = {},
): CommitmentListQuery {
  return commitmentListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), COMMITMENT_STATUSES) ?? defaults.status,
    category: list(read(params, "category"), EXPENSE_CATEGORIES),
    projectId: read(params, "projectId") || undefined,
    currency: read(params, "currency") || undefined,
    openOnly: defaults.openOnly ?? flag(params, "open"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), COMMITMENT_SORT_KEYS, defaults.sort ?? "expected-asc"),
  });
}
