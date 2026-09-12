import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { currencyTotals, toSupplierRef } from "../procurement.dto";
import { buildOrderScopeWhere, buildRfqScopeWhere } from "../procurement.scope";
import { categoryLabels } from "../procurement.status";
import * as orders from "../orders/order.service";
import type {
  DeliveryPerformanceRow,
  OutstandingReceiptRow,
  SpendRow,
} from "../procurement.types";

/**
 * Procurement reports (PRD #19 §178–§187).
 *
 * Every report is built from the reader's own scoped order query, so a project
 * manager's "spend by supplier" is the spend on their own jobs and a buyer's is
 * the company's. A report is not a back door into another project's numbers
 * (PRD #19 §340).
 *
 * **Spend means committed, not paid.** Procurement knows what was ordered;
 * what was actually paid lives in Finance. Calling an ordered figure "spend"
 * without saying which is how two modules end up disagreeing (PRD #19 §179).
 */

export type ProcurementReports = {
  spendBySupplier: SpendRow[];
  spendByProject: SpendRow[];
  spendByCategory: SpendRow[];
  openOrders: { count: number; totals: ReturnType<typeof currencyTotals> };
  outstandingReceipts: OutstandingReceiptRow[];
  deliveryPerformance: DeliveryPerformanceRow[];
  rfqSummary: { status: string; count: number }[];
};

/** Orders that count as committed spend (PRD #19 §179). */
const COMMITTED_STATUSES = [
  "APPROVED",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
] as const;

export async function procurementReports(context: UserContext): Promise<ProcurementReports> {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.report.view");

  const scope = buildOrderScopeWhere(context);

  const committed = await prisma.purchaseOrder.findMany({
    where: { AND: [scope, { status: { in: [...COMMITTED_STATUSES] }, archivedAt: null }] },
    select: {
      id: true,
      currency: true,
      totalAmount: true,
      requiredDate: true,
      status: true,
      supplier: { select: { id: true, name: true, status: true } },
      project: { select: { id: true, code: true, name: true } },
      items: {
        select: {
          totalAmount: true,
          sourceRequestItemId: true,
        },
      },
      receipts: {
        where: { status: "RECORDED" },
        select: { receiptDate: true },
        orderBy: { receiptDate: "asc" },
        take: 1,
      },
    },
  });

  const [openOrders, categories, rfqRows] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: {
        AND: [scope, { status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] }, archivedAt: null }],
      },
      select: { currency: true, totalAmount: true },
    }),
    categorySpend(context),
    can(context, "procurement.rfq.view")
      ? prisma.rFQ.groupBy({
          by: ["status"],
          where: buildRfqScopeWhere(context),
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    spendBySupplier: groupSpend(
      committed,
      (row) => row.supplier.id,
      (row) => row.supplier.name,
    ),
    spendByProject: groupSpend(
      committed,
      (row) => row.project?.id ?? "none",
      (row) => (row.project ? `${row.project.code} — ${row.project.name}` : "No project"),
    ),
    spendByCategory: categories,
    openOrders: {
      count: openOrders.length,
      totals: currencyTotals(
        openOrders.map((row) => ({ currency: row.currency, amount: row.totalAmount })),
      ),
    },
    outstandingReceipts: await outstandingReceipts(context),
    deliveryPerformance: deliveryPerformance(committed),
    rfqSummary: rfqRows.map((row) => ({ status: row.status, count: row._count._all })),
  };
}

type CommittedOrder = {
  currency: string;
  totalAmount: Prisma.Decimal;
  requiredDate: Date | null;
  supplier: { id: string; name: string; status: "ACTIVE" | "INACTIVE" | "ARCHIVED" };
  project: { id: string; code: string; name: string } | null;
  receipts: { receiptDate: Date }[];
};

function groupSpend<T extends CommittedOrder>(
  rows: T[],
  key: (row: T) => string,
  label: (row: T) => string,
): SpendRow[] {
  const groups = new Map<string, { label: string; rows: T[] }>();

  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.rows.push(row);
    else groups.set(id, { label: label(row), rows: [row] });
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      key: id,
      label: group.label,
      count: group.rows.length,
      totals: currencyTotals(
        group.rows.map((row) => ({ currency: row.currency, amount: row.totalAmount })),
      ),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Spend by category, taken from the request lines behind the order (§182).
 *
 * An order line carries no category of its own — it is priced against what a
 * supplier quoted — so the category comes from the request item it came from.
 * A line with no request behind it lands in "Uncategorised" rather than being
 * dropped, because dropping it would understate the total it belongs to.
 */
async function categorySpend(context: UserContext): Promise<SpendRow[]> {
  const rows = await prisma.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        AND: [
          buildOrderScopeWhere(context),
          { status: { in: [...COMMITTED_STATUSES] }, archivedAt: null },
        ],
      },
    },
    select: {
      totalAmount: true,
      sourceRequestItemId: true,
      purchaseOrder: { select: { currency: true } },
    },
  });

  const sourceIds = rows
    .map((row) => row.sourceRequestItemId)
    .filter((id): id is string => id !== null);

  const sources = sourceIds.length
    ? await prisma.purchaseRequestItem.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, category: true },
      })
    : [];

  const categoryById = new Map(sources.map((row) => [row.id, row.category]));

  const groups = new Map<string, { label: string; entries: { currency: string; amount: Prisma.Decimal }[] }>();

  for (const row of rows) {
    const category = row.sourceRequestItemId
      ? (categoryById.get(row.sourceRequestItemId) ?? null)
      : null;
    const key = category ?? "UNCATEGORISED";
    const label = category ? categoryLabels[category] : "Uncategorised";

    const group = groups.get(key);
    const entry = { currency: row.purchaseOrder.currency, amount: row.totalAmount };
    if (group) group.entries.push(entry);
    else groups.set(key, { label, entries: [entry] });
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      count: group.entries.length,
      totals: currencyTotals(group.entries),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Orders with something still to arrive (PRD #19 §184). */
async function outstandingReceipts(context: UserContext): Promise<OutstandingReceiptRow[]> {
  if (!can(context, "procurement.order.view")) return [];

  const list = await orders.listOrders(context, {
    page: 1,
    limit: 25,
    view: "receiving",
    sort: "required-asc",
  } as Parameters<typeof orders.listOrders>[1]);

  return list.data
    .filter((order) => order.attention.awaitingReceipt)
    .map((order) => ({
      order,
      outstandingLines: Math.max(
        Math.round(order.itemCount * (1 - order.receivedFraction)),
        order.receivedFraction >= 1 ? 0 : 1,
      ),
    }));
}

/**
 * On-time delivery per supplier (PRD #19 §185).
 *
 * Measured against the first recorded delivery, because a supplier who turned
 * up on the date agreed has met the date agreed, whatever happened to the rest
 * of a phased order. Orders with no required date are excluded rather than
 * counted as on time — no promise was made to keep.
 */
function deliveryPerformance(rows: CommittedOrder[]): DeliveryPerformanceRow[] {
  const groups = new Map<
    string,
    { supplier: CommittedOrder["supplier"]; orders: number; onTime: number; late: number }
  >();

  for (const row of rows) {
    if (!row.requiredDate || row.receipts.length === 0) continue;

    const group = groups.get(row.supplier.id) ?? {
      supplier: row.supplier,
      orders: 0,
      onTime: 0,
      late: 0,
    };

    group.orders += 1;
    if (row.receipts[0]!.receiptDate.getTime() <= row.requiredDate.getTime()) group.onTime += 1;
    else group.late += 1;

    groups.set(row.supplier.id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      supplier: toSupplierRef(group.supplier)!,
      orders: group.orders,
      onTime: group.onTime,
      late: group.late,
      onTimeRate: group.orders === 0 ? null : group.onTime / group.orders,
    }))
    .sort((a, b) => b.orders - a.orders);
}
