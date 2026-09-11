import { Prisma } from "@prisma/client";

import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { buildFinanceProjectWhere, buildInvoiceScopeWhere } from "../finance.scope";
import type { InvoiceListQuery, InvoiceSortKey } from "./invoice.schema";

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

export async function listInvoices(context: UserContext, query: InvoiceListQuery) {
  const where = buildInvoiceListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.invoice.count({ where }),
  ]);

  return { rows, total };
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
