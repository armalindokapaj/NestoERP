import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import * as financeApprovals from "@/lib/modules/finance/approvals/approval.service";
import { approveBudget, rejectBudget, returnBudget } from "@/lib/modules/finance/budgets/budget.service";
import { approveCommitment, rejectCommitment, returnCommitment } from "@/lib/modules/finance/commitments/commitment.service";
import { approveExpense, rejectExpense, returnExpense } from "@/lib/modules/finance/expenses/expense.service";
import {
  buildBudgetScopeWhere,
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
} from "@/lib/modules/finance/finance.scope";
import { approveInvoice, rejectInvoice, returnInvoice } from "@/lib/modules/finance/invoices/invoice.service";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import {
  amountWhere,
  formatAmount,
  formatDate,
  labelOf,
  MATCH_LIMIT,
  moneyOf,
  projectRef,
  projectWhere,
  startOfToday,
  term,
  valueSignals,
} from "./shared";

/**
 * Finance approvals in the Center (PRD #41 §64, §65, §182).
 *
 * Invoices, expenses, budgets and commitments, each read through Finance's own
 * scope and decided by Finance's own service — which checks the approve grant,
 * separation of duties and the record's state inside its transaction. Amounts
 * are shown because reading the record already shows them to this reader.
 */

const PROJECT = { select: { id: true, name: true, code: true } } as const;

export const financeApprovalProvider = createCycleProvider({
  key: "finance",
  moduleKey: "finance",
  label: "Finance",
  table: () => prisma.financeApproval as unknown as CycleTable,
  records: {
    INVOICE: {
      recordType: "invoice",
      noun: "Invoice",
      canView: (context) => can(context, "finance.approval.view") && can(context, "finance.invoice.view"),
      canApprove: (context) => financeApprovals.canApproveType(context, "INVOICE"),
      canReject: (context) => financeApprovals.canRejectType(context, "INVOICE"),
      selfPermission: "finance.approval.self",
      reason: "Every invoice is approved before it goes to the client.",
      async match(context, filters) {
        const rows = await prisma.invoice.findMany({
          where: {
            AND: [
              buildInvoiceScopeWhere(context),
              projectWhere(filters),
              amountWhere("totalAmount", filters),
              filters.q ? { OR: [{ invoiceNumber: term(filters.q) }, { client: { name: term(filters.q) } }, { project: { is: { name: term(filters.q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.invoice.findMany({
          where: { AND: [buildInvoiceScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            dueDate: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            notes: true,
            client: { select: { name: true } },
            project: PROJECT,
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.invoiceNumber,
              title: `${row.invoiceNumber} — ${row.client.name}`,
              subtitle: row.notes?.slice(0, 140) ?? null,
              amount: moneyOf(row.totalAmount, row.currency),
              project: projectRef(row.project),
              href: `/finance/invoices/${row.id}`,
              ...valueSignals(row.totalAmount),
              summary: [
                { label: "Client", value: row.client.name },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Issue date", value: formatDate(row.issueDate) },
                { label: "Payment due", value: formatDate(row.dueDate) },
                { label: "Subtotal", value: formatAmount(row.subtotal, row.currency) },
                { label: "Tax", value: formatAmount(row.taxAmount, row.currency) },
                { label: "Total", value: formatAmount(row.totalAmount, row.currency), emphasis: "strong" },
              ],
              description: row.notes,
              warnings:
                row.dueDate < startOfToday()
                  ? [{ code: "PAYMENT_DUE_PASSED", message: `Payment was due ${formatDate(row.dueDate)}, before this invoice was approved.`, severity: "WARNING" }]
                  : [],
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveInvoice(context, id, note, guard),
      reject: (context, id, note, guard) => rejectInvoice(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnInvoice(context, id, note, guard),
    },

    EXPENSE: {
      recordType: "expense",
      noun: "Expense",
      canView: (context) => can(context, "finance.approval.view") && can(context, "finance.expense.view"),
      canApprove: (context) => financeApprovals.canApproveType(context, "EXPENSE"),
      canReject: (context) => financeApprovals.canRejectType(context, "EXPENSE"),
      selfPermission: "finance.approval.self",
      reason: "An expense counts as project cost only once it is approved.",
      async match(context, filters) {
        const rows = await prisma.expense.findMany({
          where: {
            AND: [
              buildExpenseScopeWhere(context),
              projectWhere(filters),
              amountWhere("totalAmount", filters),
              filters.q ? { OR: [{ expenseNumber: term(filters.q) }, { description: term(filters.q) }, { payeeName: term(filters.q) }, { project: { is: { name: term(filters.q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.expense.findMany({
          where: { AND: [buildExpenseScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            expenseNumber: true,
            description: true,
            payeeName: true,
            category: true,
            expenseDate: true,
            currency: true,
            netAmount: true,
            taxAmount: true,
            totalAmount: true,
            notes: true,
            project: PROJECT,
          },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.expenseNumber,
              title: row.expenseNumber ? `${row.expenseNumber} — ${row.description}` : row.description,
              subtitle: row.payeeName,
              amount: moneyOf(row.totalAmount, row.currency),
              project: projectRef(row.project),
              href: `/finance/expenses/${row.id}`,
              ...valueSignals(row.totalAmount),
              summary: [
                { label: "Payee", value: row.payeeName ?? "—" },
                { label: "Category", value: labelOf(row.category) },
                { label: "Project", value: row.project?.name ?? "Company overhead" },
                { label: "Expense date", value: formatDate(row.expenseDate) },
                { label: "Net", value: formatAmount(row.netAmount, row.currency) },
                { label: "Tax", value: formatAmount(row.taxAmount, row.currency) },
                { label: "Total", value: formatAmount(row.totalAmount, row.currency), emphasis: "strong" },
              ],
              description: row.notes,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveExpense(context, id, note, guard),
      reject: (context, id, note, guard) => rejectExpense(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnExpense(context, id, note, guard),
    },

    BUDGET: {
      recordType: "budget",
      noun: "Budget",
      canView: (context) => can(context, "finance.approval.view") && can(context, "finance.budget.view"),
      canApprove: (context) => financeApprovals.canApproveType(context, "BUDGET"),
      canReject: (context) => financeApprovals.canRejectType(context, "BUDGET"),
      selfPermission: "finance.approval.self",
      reason: "A project budget is approved before project cost is measured against it.",
      async match(context, filters) {
        const rows = await prisma.projectBudget.findMany({
          where: {
            AND: [
              buildBudgetScopeWhere(context),
              projectWhere(filters),
              amountWhere("totalAmount", filters),
              filters.q ? { OR: [{ name: term(filters.q) }, { project: { name: term(filters.q) } }, { project: { code: term(filters.q) } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.projectBudget.findMany({
          where: { AND: [buildBudgetScopeWhere(context), { id: { in: ids } }] },
          select: { id: true, name: true, version: true, currency: true, totalAmount: true, notes: true, projectId: true, project: PROJECT },
        });
        const current = await prisma.projectBudget.findMany({
          where: { projectId: { in: rows.map((row) => row.projectId) }, isCurrent: true, status: "APPROVED" },
          select: { id: true, projectId: true, totalAmount: true, currency: true, version: true },
        });
        const currentByProject = new Map(current.map((row) => [row.projectId, row]));
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const standing = currentByProject.get(row.projectId);
            const delta = standing && standing.id !== row.id ? row.totalAmount.minus(standing.totalAmount) : null;
            return [
              row.id,
              {
                id: row.id,
                reference: `${row.project.code} v${row.version}`,
                title: `${row.project.name} budget v${row.version}`,
                subtitle: row.name,
                amount: moneyOf(row.totalAmount, row.currency),
                project: projectRef(row.project),
                href: `/finance/budgets/${row.id}`,
                ...valueSignals(row.totalAmount),
                summary: [
                  { label: "Project", value: `${row.project.code} · ${row.project.name}` },
                  { label: "Version", value: String(row.version) },
                  { label: "Total budget", value: formatAmount(row.totalAmount, row.currency), emphasis: "strong" },
                  ...(standing && standing.id !== row.id ? [{ label: `Approved v${standing.version}`, value: formatAmount(standing.totalAmount, standing.currency) }] : []),
                ],
                description: row.notes,
                warnings:
                  delta && delta.gt(0)
                    ? [{ code: "BUDGET_INCREASE", message: `Raises the approved budget by ${formatAmount(delta, row.currency)}.`, severity: "WARNING" }]
                    : [],
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveBudget(context, id, note, guard),
      reject: (context, id, note, guard) => rejectBudget(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnBudget(context, id, note, guard),
    },

    COMMITMENT: {
      recordType: "commitment",
      noun: "Commitment",
      canView: (context) => can(context, "finance.approval.view") && can(context, "finance.commitment.view"),
      canApprove: (context) => financeApprovals.canApproveType(context, "COMMITMENT"),
      canReject: (context) => financeApprovals.canRejectType(context, "COMMITMENT"),
      selfPermission: "finance.approval.self",
      reason: "Money promised to a counterparty is approved before it counts against the budget.",
      async match(context, filters) {
        const rows = await prisma.commitment.findMany({
          where: {
            AND: [
              buildCommitmentScopeWhere(context),
              projectWhere(filters),
              amountWhere("amount", filters),
              filters.q ? { OR: [{ reference: term(filters.q) }, { description: term(filters.q) }, { counterpartyName: term(filters.q) }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.commitment.findMany({
          where: { AND: [buildCommitmentScopeWhere(context), { id: { in: ids } }] },
          select: { id: true, reference: true, description: true, counterpartyName: true, category: true, currency: true, amount: true, expectedDate: true, notes: true, project: PROJECT },
        });
        return new Map(
          rows.map((row): [string, RecordFacts] => [
            row.id,
            {
              id: row.id,
              reference: row.reference,
              title: row.reference ? `${row.reference} — ${row.description}` : row.description,
              subtitle: row.counterpartyName,
              amount: moneyOf(row.amount, row.currency),
              project: projectRef(row.project),
              href: `/finance/commitments/${row.id}`,
              ...valueSignals(row.amount),
              summary: [
                { label: "Counterparty", value: row.counterpartyName ?? "—" },
                { label: "Category", value: labelOf(row.category) },
                { label: "Project", value: row.project?.name ?? "—" },
                { label: "Expected", value: formatDate(row.expectedDate) },
                { label: "Amount", value: formatAmount(row.amount, row.currency), emphasis: "strong" },
              ],
              description: row.notes,
            },
          ]),
        );
      },
      approve: (context, id, note, guard) => approveCommitment(context, id, note, guard),
      reject: (context, id, note, guard) => rejectCommitment(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnCommitment(context, id, note, guard),
    },
  },
});
