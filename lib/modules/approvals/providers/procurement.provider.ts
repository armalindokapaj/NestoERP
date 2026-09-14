import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { orderReadableBy, planOrderChain, resolveApprovalPolicy } from "@/lib/modules/procurement/approvals/approval.policy";
import * as procurementApprovals from "@/lib/modules/procurement/approvals/approval.service";
import { approveOrder, rejectOrder, returnOrder } from "@/lib/modules/procurement/orders/order.service";
import { buildOrderScopeWhere, buildRequestScopeWhere } from "@/lib/modules/procurement/procurement.scope";
import { approveRequest, rejectRequest, returnRequest } from "@/lib/modules/procurement/requests/request.service";
import type { ApprovalPriority } from "../approvals.types";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { amountWhere, formatAmount, formatDate, MATCH_LIMIT, moneyOf, projectRef, projectWhere, startOfToday, term, valueSignals } from "./shared";

/**
 * Procurement approvals in the Center (PRD #41 §66, §67, §146).
 *
 * Purchase requests and purchase orders, through Procurement's scope. An order
 * above the company's approval limits carries a chain Procurement wrote when
 * it was submitted — Procurement, then Finance, then an executive — and only
 * whoever holds the current step can decide it (§21, §27, §262).
 *
 * Quote comparison is commercially confidential (PRD #19 §260): it is shown
 * only to a reader holding `procurement.quote.view`.
 */

const PRIORITY: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", ApprovalPriority> = {
  LOW: "LOW",
  MEDIUM: "NORMAL",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const DAY = 86_400_000;

export const procurementApprovalProvider = createCycleProvider({
  key: "procurement",
  moduleKey: "procurement",
  label: "Procurement",
  table: () => prisma.procurementApproval as unknown as CycleTable,
  chain: { canReadAs: (recordId) => orderReadableBy(recordId) },
  records: {
    PURCHASE_REQUEST: {
      recordType: "purchase_request",
      noun: "Purchase request",
      canView: (context) => can(context, "procurement.approval.view") && can(context, "procurement.request.view"),
      canApprove: (context) => procurementApprovals.canApproveType(context, "PURCHASE_REQUEST"),
      canReject: (context) => procurementApprovals.canRejectType(context, "PURCHASE_REQUEST"),
      selfPermission: "procurement.approval.self",
      reason: "A purchase request is approved before anybody asks suppliers for prices.",
      async match(context, filters) {
        const rows = await prisma.purchaseRequest.findMany({
          where: {
            AND: [
              buildRequestScopeWhere(context),
              projectWhere(filters),
              amountWhere("estimatedTotal", filters),
              filters.q ? { OR: [{ requestNumber: term(filters.q) }, { title: term(filters.q) }, { project: { is: { name: term(filters.q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.purchaseRequest.findMany({
          where: { AND: [buildRequestScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            requestNumber: true,
            title: true,
            description: true,
            priority: true,
            requiredDate: true,
            currency: true,
            estimatedTotal: true,
            project: { select: { id: true, name: true, code: true } },
            department: { select: { name: true } },
            _count: { select: { items: true } },
          },
        });
        const today = startOfToday();
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const value = valueSignals(row.estimatedTotal);
            const priority = PRIORITY[row.priority];
            return [
              row.id,
              {
                id: row.id,
                reference: row.requestNumber,
                title: `${row.requestNumber} — ${row.title}`,
                subtitle: row.project?.name ?? row.department?.name ?? null,
                amount: moneyOf(row.estimatedTotal, row.currency),
                project: projectRef(row.project),
                href: `/procurement/requests/${row.id}`,
                priority: priority === "NORMAL" || priority === "LOW" ? (value.priority === "HIGH" ? "HIGH" : priority) : priority,
                requiresStrongConfirmation: value.requiresStrongConfirmation,
                summary: [
                  { label: "Project", value: row.project?.name ?? "—" },
                  { label: "Department", value: row.department?.name ?? "—" },
                  { label: "Priority", value: row.priority.charAt(0) + row.priority.slice(1).toLowerCase() },
                  { label: "Needed by", value: formatDate(row.requiredDate) },
                  { label: "Lines", value: String(row._count.items) },
                  { label: "Estimated total", value: formatAmount(row.estimatedTotal, row.currency), emphasis: "strong" },
                ],
                description: row.description,
                warnings:
                  row.requiredDate && row.requiredDate.getTime() - today.getTime() < 7 * DAY
                    ? [{ code: "NEEDED_SOON", message: `Needed by ${formatDate(row.requiredDate)} — little time is left to source it.`, severity: "WARNING" }]
                    : [],
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveRequest(context, id, note, guard),
      reject: (context, id, note, guard) => rejectRequest(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnRequest(context, id, note, guard),
    },

    PURCHASE_ORDER: {
      recordType: "purchase_order",
      noun: "Purchase order",
      canView: (context) => can(context, "procurement.approval.view") && can(context, "procurement.order.view"),
      canApprove: (context) => procurementApprovals.canApproveType(context, "PURCHASE_ORDER"),
      canReject: (context) => procurementApprovals.canRejectType(context, "PURCHASE_ORDER"),
      selfPermission: "procurement.approval.self",
      reason: "A purchase order commits money to a supplier, so it is approved before it is issued.",
      async match(context, filters) {
        const rows = await prisma.purchaseOrder.findMany({
          where: {
            AND: [
              buildOrderScopeWhere(context),
              projectWhere(filters),
              amountWhere("totalAmount", filters),
              filters.q ? { OR: [{ poNumber: term(filters.q) }, { supplier: { name: term(filters.q) } }, { project: { is: { name: term(filters.q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const [rows, policy] = await Promise.all([
          prisma.purchaseOrder.findMany({
            where: { AND: [buildOrderScopeWhere(context), { id: { in: ids } }] },
            select: {
              id: true,
              poNumber: true,
              orderDate: true,
              requiredDate: true,
              currency: true,
              subtotal: true,
              taxAmount: true,
              totalAmount: true,
              modifiedFromQuote: true,
              notes: true,
              rfqId: true,
              supplierQuoteId: true,
              supplier: { select: { name: true, status: true } },
              project: { select: { id: true, name: true, code: true } },
              purchaseRequest: { select: { requestNumber: true } },
              _count: { select: { items: true } },
            },
          }),
          resolveApprovalPolicy(context.companyId),
        ]);
        const seeQuotes = can(context, "procurement.quote.view");
        const quotes = seeQuotes
          ? await prisma.supplierQuote.findMany({
              where: { companyId: context.companyId, rfqId: { in: rows.map((row) => row.rfqId).filter((id): id is string => Boolean(id)) }, status: { not: "DISQUALIFIED" } },
              select: { id: true, rfqId: true, totalAmount: true, currency: true },
            })
          : [];
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const chain = planOrderChain(policy, { totalAmount: row.totalAmount, currency: row.currency });
            const value = valueSignals(row.totalAmount);
            const warnings: NonNullable<RecordFacts["warnings"]> = [];
            if (row.supplier.status !== "ACTIVE") {
              warnings.push({ code: "SUPPLIER_BLOCKED", message: `${row.supplier.name} is ${row.supplier.status.toLowerCase()}.`, severity: "CRITICAL" });
            }
            if (row.modifiedFromQuote) {
              warnings.push({ code: "CHANGED_FROM_QUOTE", message: "Prices or quantities were changed from the selected quote.", severity: "WARNING" });
            }
            if (chain.currencyMismatch) {
              warnings.push({ code: "CURRENCY_NOT_COMPARABLE", message: `Approval limits are in ${policy?.currency}; this order is in ${row.currency}.`, severity: "INFO" });
            }
            const comparable = quotes.filter((quote) => quote.rfqId === row.rfqId && quote.currency === row.currency);
            const summary: RecordFacts["summary"] = [
              { label: "Supplier", value: row.supplier.name },
              { label: "Project", value: row.project?.name ?? "—" },
              { label: "Purchase request", value: row.purchaseRequest?.requestNumber ?? "—" },
              { label: "Order date", value: formatDate(row.orderDate) },
              { label: "Delivery required", value: formatDate(row.requiredDate) },
              { label: "Lines", value: String(row._count.items) },
              { label: "Subtotal", value: formatAmount(row.subtotal, row.currency) },
              { label: "Tax", value: formatAmount(row.taxAmount, row.currency) },
              { label: "PO total", value: formatAmount(row.totalAmount, row.currency), emphasis: "strong" },
            ];
            if (seeQuotes && comparable.length > 0) {
              const lowest = comparable.reduce((best, quote) => (quote.totalAmount.lt(best.totalAmount) ? quote : best));
              const isLowest = lowest.id === row.supplierQuoteId;
              summary.push({
                label: "Quotes",
                value: `${comparable.length} received${isLowest ? " · this is the lowest" : ` · lowest ${formatAmount(lowest.totalAmount, lowest.currency)}`}`,
                emphasis: isLowest ? "normal" : "warning",
              });
              if (!isLowest && row.supplierQuoteId) {
                warnings.push({ code: "NOT_LOWEST_QUOTE", message: `A lower quote of ${formatAmount(lowest.totalAmount, lowest.currency)} was received.`, severity: "INFO" });
              }
            }
            return [
              row.id,
              {
                id: row.id,
                reference: row.poNumber,
                title: `${row.poNumber} — ${row.supplier.name}`,
                subtitle: row.notes?.slice(0, 140) ?? null,
                amount: moneyOf(row.totalAmount, row.currency),
                project: projectRef(row.project),
                href: `/procurement/orders/${row.id}`,
                priority: chain.steps.length > 2 ? "HIGH" : value.priority,
                requiresStrongConfirmation: value.requiresStrongConfirmation || chain.steps.length > 2,
                summary,
                description: row.notes,
                warnings,
                reason: chain.reason,
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveOrder(context, id, note, guard),
      reject: (context, id, note, guard) => rejectOrder(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnOrder(context, id, note, guard),
    },
  },
});
