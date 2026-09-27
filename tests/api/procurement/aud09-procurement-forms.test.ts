import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/lib/actions/procurement";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { orderSchema, quoteSchema } from "@/lib/modules/procurement/procurement.schema";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * AUD-09 — Procurement forms (FV-05, FV-06, FV-07, FV-09, FV-10, FV-16).
 * Real services and actions as the seeded Procurement account; persisted state
 * asserted in the database; every refusal paired with a positive control.
 */

const PREFIX = "aud09c_";
const made = { orders: new Set<string>(), suppliers: new Set<string>() };
const restoreSupplier: { id: string; status: "ACTIVE" | "INACTIVE" }[] = [];

afterEach(async () => {
  const orderIds = [...made.orders];
  if (orderIds.length > 0) {
    const receipts = await prisma.goodsReceipt.findMany({ where: { purchaseOrderId: { in: orderIds } }, select: { id: true } });
    const receiptIds = receipts.map((row) => row.id);
    await prisma.activity.deleteMany({ where: { entityId: { in: [...orderIds, ...receiptIds] } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: [...orderIds, ...receiptIds] } } });
    await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (made.suppliers.size > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: [...made.suppliers] } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [...made.suppliers] } } });
  }
  for (const row of restoreSupplier.splice(0)) await prisma.supplier.update({ where: { id: row.id }, data: { status: row.status } });
  made.orders.clear();
  made.suppliers.clear();
});

afterAll(async () => {
  actAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function asProcurement<T>(run: () => Promise<T>): Promise<T> {
  actAs(await loginAs("PROCUREMENT"));
  try {
    return await run();
  } finally {
    actAs(null);
  }
}

async function draftFromQuote009() {
  const context = await loginAs("PROCUREMENT");
  const quoteItems = await prisma.supplierQuoteItem.findMany({ where: { supplierQuoteId: "quote_009" }, select: { id: true, quantity: true, unitPrice: true, taxRate: true } });
  const order = await orders.createOrder(
    context,
    orderSchema.parse({
      supplierId: "supplier_meridian",
      rfqId: "rfq_004",
      supplierQuoteId: "quote_009",
      projectId: PROJECT.a,
      orderDate: "2026-03-01",
      currency: "EUR",
      notes: `${PREFIX}order`,
      items: quoteItems.map((item, index) => ({
        sourceQuoteItemId: item.id,
        description: `${PREFIX}line ${index}`,
        quantity: item.quantity.toString(),
        unit: "each",
        unitPrice: item.unitPrice.toString(),
        taxRate: item.taxRate.toString(),
      })),
    }),
  );
  made.orders.add(order.id);
  return order;
}

describe("FV-06 — procurement numbers", () => {
  it("refuses the thousands comma that used to become 1, and a float-decided comparison", () => {
    const result = orderSchema.safeParse({
      supplierId: "supplier_atlas",
      orderDate: "2026-03-01",
      currency: "EUR",
      items: [{ description: "Cement bags", quantity: "1,000", unit: "bag", unitPrice: "5", taxRate: "0.2" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["items.0.quantity"]);
  });

  it("reads a decimal comma and an empty tax as zero tax (positive control)", () => {
    const parsed = orderSchema.parse({
      supplierId: "supplier_atlas",
      orderDate: "2026-03-01",
      currency: "EUR",
      items: [{ description: "Cement bags", quantity: "12,5", unit: "bag", unitPrice: "5", taxRate: "" }],
    });
    expect(parsed.items[0]).toMatchObject({ quantity: "12.5", taxRate: "0" });
  });
});

describe("FV-07 — dates in order", () => {
  it("refuses a required-by date before the order date, on that field", () => {
    const result = orderSchema.safeParse({
      supplierId: "supplier_atlas",
      orderDate: "2026-03-10",
      requiredDate: "2026-03-09",
      currency: "EUR",
      items: [{ description: "Sand", quantity: "1", unit: "t", unitPrice: "1" }],
    });
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["requiredDate"]);
  });

  it("refuses a quote valid until before its date; the same day passes", () => {
    const base = { supplierId: "supplier_atlas", quoteDate: "2026-03-10", items: [{ rfqItemId: "x", quantity: "1", unitPrice: "1" }] };
    expect(quoteSchema.safeParse({ ...base, validUntil: "2026-03-09" }).error?.issues.map((issue) => issue.path.join("."))).toEqual(["validUntil"]);
    expect(quoteSchema.safeParse({ ...base, validUntil: "2026-03-10", leadTimeDays: "" }).success).toBe(true);
    expect(quoteSchema.parse({ ...base, leadTimeDays: "" }).leadTimeDays).toBeUndefined();
  });
});

describe("FV-05 / FV-09 / FV-10 — an order edit keeps what the form does not send", () => {
  it("keeps the quote and enquiry links and each line's quote line through an ordinary edit", async () => {
    const order = await draftFromQuote009();
    const saved = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, select: { items: { orderBy: { sortOrder: "asc" }, select: { id: true, sourceQuoteItemId: true, quantity: true, unitPrice: true, taxRate: true } } } });

    const entries: Record<string, string> = {
      supplierId: "supplier_meridian",
      projectId: PROJECT.a,
      orderDate: "2026-03-02",
      currency: "EUR",
      notes: `${PREFIX}order edited`,
    };
    saved.items.forEach((item, index) => {
      entries[`items.${index}.id`] = item.id;
      entries[`items.${index}.description`] = `${PREFIX}line ${index}`;
      entries[`items.${index}.quantity`] = item.quantity.toString();
      entries[`items.${index}.unit`] = "each";
      entries[`items.${index}.unitPrice`] = item.unitPrice.toString();
      entries[`items.${index}.taxRate`] = item.taxRate.toString();
    });
    const result = await asProcurement(() => actions.updateOrderAction(order.id, form(entries)));
    expect(result.ok).toBe(true);

    const after = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { rfqId: true, supplierQuoteId: true, modifiedFromQuote: true, notes: true, items: { orderBy: { sortOrder: "asc" }, select: { sourceQuoteItemId: true } } },
    });
    expect(after).toMatchObject({ rfqId: "rfq_004", supplierQuoteId: "quote_009", modifiedFromQuote: false, notes: `${PREFIX}order edited` });
    expect(after.items.map((item) => item.sourceQuoteItemId)).toEqual(saved.items.map((item) => item.sourceQuoteItemId));
  });

  it("refuses a quote from another supplier; the quote's own supplier passes", async () => {
    const context = await loginAs("PROCUREMENT");
    const input = (supplierId: string) =>
      orderSchema.parse({
        supplierId,
        supplierQuoteId: "quote_009",
        orderDate: "2026-03-01",
        currency: "EUR",
        notes: `${PREFIX}order`,
        items: [{ description: `${PREFIX}x`, quantity: "1", unit: "each", unitPrice: "1" }],
      });
    await expect(orders.createOrder(context, input("supplier_atlas"))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "INVALID_QUOTE" } });
    expect(await prisma.purchaseOrder.count({ where: { notes: `${PREFIX}order`, supplierId: "supplier_atlas" } })).toBe(0);
    const ok = await orders.createOrder(context, input("supplier_meridian"));
    made.orders.add(ok.id);
    expect(ok.id).toBeTruthy();
  });

  it("refuses a quote line that is not the quote's", async () => {
    const context = await loginAs("PROCUREMENT");
    const foreignLine = await prisma.supplierQuoteItem.findFirstOrThrow({ where: { supplierQuoteId: "quote_010" }, select: { id: true } });
    await expect(
      orders.createOrder(
        context,
        orderSchema.parse({
          supplierId: "supplier_meridian",
          supplierQuoteId: "quote_009",
          orderDate: "2026-03-01",
          currency: "EUR",
          notes: `${PREFIX}order`,
          items: [{ sourceQuoteItemId: foreignLine.id, description: `${PREFIX}x`, quantity: "1", unit: "each", unitPrice: "1" }],
        }),
      ),
    ).rejects.toMatchObject({ details: { code: "INVALID_SOURCE_LINE" } });
    expect(await prisma.purchaseOrder.count({ where: { notes: `${PREFIX}order` } })).toBe(0);
  });

  it("a supplier edit that leaves status out keeps an inactive supplier inactive", async () => {
    const context = await loginAs("PROCUREMENT");
    const created = await asProcurement(() => actions.createSupplierAction(form({ name: `${PREFIX}Supplier ${Date.now()}`, status: "INACTIVE", supplierType: "COMPANY", paymentTermsDays: "" })));
    expect(created.ok).toBe(true);
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { companyId: context.companyId, name: { startsWith: `${PREFIX}Supplier` } }, select: { id: true, name: true, status: true, paymentTermsDays: true } });
    made.suppliers.add(supplier.id);
    // Empty payment terms are "not set", not 0 days.
    expect(supplier).toMatchObject({ status: "INACTIVE", paymentTermsDays: null });

    const edited = await asProcurement(() => actions.updateSupplierAction(supplier.id, form({ name: supplier.name, paymentTermsDays: "30" })));
    expect(edited.ok).toBe(true);
    const after = await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id }, select: { status: true, paymentTermsDays: true } });
    expect(after).toEqual({ status: "INACTIVE", paymentTermsDays: 30 });

    const refused = await asProcurement(() => actions.updateSupplierAction(supplier.id, form({ name: supplier.name, paymentTermsDays: "1e2" })));
    expect(refused.ok ? null : Object.keys(refused.fieldErrors ?? {})).toEqual(["paymentTermsDays"]);
  });
});

describe("FV-16 — a delivery need not bring every line", () => {
  it("leaves a line at 0 out of the receipt and books the rest; errors name the submitted row", async () => {
    const context = await loginAs("PROCUREMENT");
    const order = await orders.createOrder(
      context,
      orderSchema.parse({
        supplierId: "supplier_atlas",
        projectId: PROJECT.a,
        orderDate: "2026-03-01",
        currency: "EUR",
        notes: `${PREFIX}order`,
        items: [
          { description: `${PREFIX}a`, quantity: "5", unit: "each", unitPrice: "1" },
          { description: `${PREFIX}b`, quantity: "5", unit: "each", unitPrice: "1" },
        ],
      }),
    );
    made.orders.add(order.id);
    // Fixture: the order has been sent to the supplier.
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "ISSUED" } });
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id }, orderBy: { sortOrder: "asc" }, select: { id: true } });

    const lines = (second: { received: string; rejected: string }) => ({
      receiptDate: "2026-03-05",
      "items.0.purchaseOrderItemId": items[0].id,
      "items.0.description": "a",
      "items.0.receivedQuantity": "0",
      "items.0.rejectedQuantity": "0",
      "items.1.purchaseOrderItemId": items[1].id,
      "items.1.description": "b",
      "items.1.receivedQuantity": second.received,
      "items.1.rejectedQuantity": second.rejected,
    });

    const refused = await asProcurement(() => actions.recordReceiptAction(order.id, form(lines({ received: "2", rejected: "2,5" }))));
    expect(refused.ok ? null : refused.fieldErrors).toEqual({ "items.1.rejectedQuantity": ["You cannot reject more than arrived."] });
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0);

    const booked = await asProcurement(() => actions.recordReceiptAction(order.id, form(lines({ received: "2", rejected: "0,5" }))));
    expect(booked.ok).toBe(true);
    const receipt = await prisma.goodsReceipt.findFirstOrThrow({ where: { purchaseOrderId: order.id }, select: { items: { select: { purchaseOrderItemId: true, receivedQuantity: true, rejectedQuantity: true, acceptedQuantity: true } } } });
    expect(receipt.items.map((item) => [item.purchaseOrderItemId, item.receivedQuantity.toFixed(4), item.rejectedQuantity.toFixed(4), item.acceptedQuantity.toFixed(4)])).toEqual([
      [items[1].id, "2.0000", "0.5000", "1.5000"],
    ]);
  });
});
