import { Prisma } from "@prisma/client";

import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause } from "@/lib/modules/shared/list-query";
import { readRegisterSnapshot, registerSlice, registerSummary, type RegisterWindow } from "../finance.register";
import { buildFinanceProjectWhere, buildInvoiceScopeWhere } from "../finance.scope";
import type { InvoiceListQuery, InvoiceSortKey } from "./invoice.schema";
import { invoiceSettlementWhere } from "./invoice.status";

/** Invoice queries (PRD #15 §160–§164, §262). */

const ORDER: Record<InvoiceSortKey, Prisma.InvoiceOrderByWithRelationInput[]> = {
  "issue-desc": [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
  "issue-asc": [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
  "due-asc": [{ dueDate: "asc" }],
  "due-desc": [{ dueDate: "desc" }],
  "amount-desc": [{ totalAmount: "desc" }],
  "amount-asc": [{ totalAmount: "asc" }],
  "number-asc": [{ invoiceNumber: "asc" }],
  "number-desc": [{ invoiceNumber: "desc" }],
  "updated-desc": [{ updatedAt: "desc" }],
};

export const SUMMARY_SELECT = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  dueDate: true,
  currency: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  status: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.InvoiceSelect;

export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  preArchiveStatus: true,
  contractId: true,
  installmentId: true,
  notes: true,
  sentAt: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  lineItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      taxRate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.InvoiceSelect;

export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ select: typeof DETAIL_SELECT }>;

export function buildInvoiceListWhere(
  context: UserContext,
  query: InvoiceListQuery,
): Prisma.InvoiceWhereInput {
  const filters: Prisma.InvoiceWhereInput[] = [buildInvoiceScopeWhere(context)];

  // Archived invoices are absent unless asked for, and `ARCHIVED` is not a
  // status anyone can filter into by accident (PRD #15 §68).
  filters.push(
    query.archived
      ? { status: "ARCHIVED" }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, ["invoiceNumber", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.InvoiceWhereInput),
        // Searching a client name is fine: the scope clause above already
        // decided which invoices are reachable (PRD #15 §174).
        { client: { name: { contains: term, mode: "insensitive" } } },
        { project: { name: { contains: term, mode: "insensitive" } } },
        { project: { code: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.issuedFrom) filters.push({ issueDate: { gte: query.issuedFrom } });
  if (query.issuedTo) filters.push({ issueDate: { lte: query.issuedTo } });

  return { AND: filters };
}

/**
 * The register's order: the chosen sort, then the id (AUD-01 §5.2). Several
 * invoices — in one company or across the group — can share a date, an amount
 * or a number, and without the id a record could sit on two pages or none.
 */
function registerOrder(sort: InvoiceSortKey): Prisma.InvoiceOrderByWithRelationInput[] {
  return [...ORDER[sort], { id: "asc" }];
}

/** A register row: the summary, its company, and what it has been paid in this snapshot. */
export const REGISTER_SELECT = {
  ...SUMMARY_SELECT,
  companyId: true,
  settlement: { select: { paidAmount: true } },
} satisfies Prisma.InvoiceSelect;

export type InvoiceRegisterRow = Prisma.InvoiceGetPayload<{ select: typeof REGISTER_SELECT }>;

/**
 * The invoice register — list, count, filtered totals and export (AUD-01 §4).
 *
 * `contexts` is the reader in each company answered for: the session alone in a
 * company workspace, or every company the Group workspace may read. Each company
 * keeps its own list clause — its scope, the archive rule, the search and the
 * filters — and the union is filtered by settlement in the database, through
 * the settlement view, before anything is counted, totalled or paged. The
 * view-side clause names the companies too, so Postgres aggregates only theirs.
 */
export async function readInvoiceRegister(
  contexts: UserContext[],
  query: InvoiceListQuery,
  read: { evaluatedAt: Date; window: RegisterWindow; timeoutMs?: number },
) {
  // Nothing readable is an empty answer, not an error (Workspace Context §76).
  if (contexts.length === 0) return { rows: [] as InvoiceRegisterRow[], summary: registerSummary("invoices", [], read.evaluatedAt), page: 1 };

  const eligible: Prisma.InvoiceWhereInput =
    contexts.length === 1 ? buildInvoiceListWhere(contexts[0], query) : { OR: contexts.map((context) => buildInvoiceListWhere(context, query)) };
  const companies: Prisma.InvoiceSettlementWhereInput = { companyId: { in: contexts.map((context) => context.companyId) } };
  const settled = query.settlement?.length ? invoiceSettlementWhere(query.settlement, read.evaluatedAt) : null;

  return readRegisterSnapshot(
    "invoices",
    async (tx) => {
      const groups = await tx.invoiceSettlement.groupBy({
        by: ["currency"],
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true, integrityIssues: true },
        orderBy: { currency: "asc" },
        where: { AND: [companies, ...(settled ? [settled] : []), { invoice: { is: eligible } }] },
      });
      const summary = registerSummary("invoices", groups, read.evaluatedAt);
      const slice = registerSlice(read.window, summary.matchingCount);

      const rows =
        slice.take === 0
          ? []
          : await tx.invoice.findMany({
              where: settled ? { AND: [eligible, { settlement: { is: { AND: [companies, settled] } } }] } : eligible,
              orderBy: registerOrder(query.sort),
              skip: slice.skip,
              take: slice.take,
              select: REGISTER_SELECT,
            });

      return { rows, summary, page: slice.page };
    },
    { timeoutMs: read.timeoutMs },
  );
}

/**
 * One invoice's settlement row, for a detail read to refuse a figure an
 * allocation from another company or currency would inflate (AUD-01 §3).
 */
export function invoiceSettlementRow(invoiceId: string) {
  return prisma.invoiceSettlement.findUnique({ where: { invoiceId }, select: { integrityIssues: true } });
}

export function findInvoiceInScope(context: UserContext, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { AND: [buildInvoiceScopeWhere(context), { id: invoiceId }] },
    select: DETAIL_SELECT,
  });
}

/** Filter options drawn from the invoices this reader can already see. */
export async function invoiceFilterOptions(context: UserContext) {
  const scope = buildInvoiceScopeWhere(context);

  const [clients, projects, currencies] = await Promise.all([
    prisma.client.findMany({
      where: { companyId: context.companyId, invoices: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { companyId: context.companyId, invoices: { some: scope } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.invoice.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return { clients, projects, currencies: currencies.map((row) => row.currency) };
}

/** Currencies of the invoices the Group workspace reads: no client or project, which belong to one company. */
export async function invoiceCurrenciesAcross(contexts: UserContext[]): Promise<string[]> {
  if (contexts.length === 0) return [];
  const rows = await prisma.invoice.findMany({
    where: { OR: contexts.map((context) => buildInvoiceScopeWhere(context)) },
    select: { currency: true },
    distinct: ["currency"],
    orderBy: { currency: "asc" },
  });
  return rows.map((row) => row.currency);
}

/** Clients and projects a new invoice may name (PRD #15 §48, §49). */
export async function invoiceFormOptions(context: UserContext) {
  const [clients, projects] = await Promise.all([
    prisma.client.findMany({
      where: {
        AND: [buildClientScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: buildFinanceProjectWhere(context),
      select: { id: true, code: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { clients, projects };
}

/** Invoices a payment may settle: sent, in scope, still owing something. */
export function sentInvoicesInScope(context: UserContext) {
  return prisma.invoice.findMany({
    where: { AND: [buildInvoiceScopeWhere(context), { status: "SENT" }] },
    select: {
      id: true,
      invoiceNumber: true,
      currency: true,
      totalAmount: true,
      client: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
}
