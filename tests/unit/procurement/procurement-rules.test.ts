import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import {
  ORDER_STATUSES,
  REQUEST_STATUSES,
  acceptsQuotes,
  acceptsReceipts,
  acceptsSourcing,
  canTransitionOrderStatus,
  canTransitionQuoteStatus,
  canTransitionRequestStatus,
  canTransitionRfqStatus,
  daysBetween,
  isOrderArchivable,
  isOrderEditable,
  isQuoteSelectable,
  isRequestEditable,
  isRfqEditable,
  isSupplierSelectable,
  receiptStatusFor,
} from "@/lib/modules/procurement/procurement.status";
import { requestItemSchema, receiptSchema } from "@/lib/modules/procurement/procurement.schema";
import {
  documentTotals,
  estimatedTotal,
  lineTotals,
  quantityString,
  sumLineTotals,
} from "@/lib/modules/procurement/procurement.money";

/**
 * Procurement rules (PRD #19 §190–§194, §245–§248).
 *
 * Pure functions, no database. Two ideas are load-bearing:
 *
 *   1. **Money rounds at the line, and a document total is the sum of rounded
 *      lines.** Summing unrounded lines and rounding at the end gives a total
 *      that disagrees with the column above it by a cent — the kind of
 *      disagreement a supplier notices (PRD #19 §193).
 *   2. **Receiving is derived from quantity, never clicked** (PRD #19 §141).
 */

describe("request lifecycle (PRD #19 §245)", () => {
  it("walks draft → approval → sourcing → ordered", () => {
    expect(canTransitionRequestStatus("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionRequestStatus("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionRequestStatus("APPROVED", "IN_SOURCING")).toBe(true);
    expect(canTransitionRequestStatus("IN_SOURCING", "PARTIALLY_ORDERED")).toBe(true);
    expect(canTransitionRequestStatus("PARTIALLY_ORDERED", "ORDERED")).toBe(true);
    expect(canTransitionRequestStatus("ORDERED", "COMPLETED")).toBe(true);
  });

  it("sends a rejected request back to the desk it came from", () => {
    expect(canTransitionRequestStatus("PENDING_APPROVAL", "REJECTED")).toBe(true);
    // It is corrected where it stands and resubmitted without a round trip
    // through DRAFT — nothing moves it back there (PRD #49 §132: the table is
    // what the service does). Only a return for revision reaches DRAFT.
    expect(isRequestEditable("REJECTED")).toBe(true);
    expect(canTransitionRequestStatus("REJECTED", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionRequestStatus("REJECTED", "DRAFT")).toBe(false);
    expect(canTransitionRequestStatus("PENDING_APPROVAL", "DRAFT")).toBe(true);
  });

  it("refuses a jump that skips approval", () => {
    expect(canTransitionRequestStatus("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionRequestStatus("DRAFT", "ORDERED")).toBe(false);
  });

  it("gives the archive no outgoing edge", () => {
    for (const status of REQUEST_STATUSES) {
      expect(canTransitionRequestStatus("ARCHIVED", status)).toBe(false);
    }
  });

  it("freezes the lines once somebody has approved them (PRD #19 §55)", () => {
    expect(isRequestEditable("DRAFT")).toBe(true);
    expect(isRequestEditable("REJECTED")).toBe(true);
    expect(isRequestEditable("APPROVED")).toBe(false);
    expect(isRequestEditable("ORDERED")).toBe(false);
  });

  it("opens sourcing only once the ask is approved (PRD #19 §61)", () => {
    expect(acceptsSourcing("DRAFT")).toBe(false);
    expect(acceptsSourcing("APPROVED")).toBe(true);
    expect(acceptsSourcing("IN_SOURCING")).toBe(true);
    expect(acceptsSourcing("COMPLETED")).toBe(false);
  });
});

describe("order lifecycle (PRD #19 §248)", () => {
  it("walks draft → approval → issued → received → closed", () => {
    expect(canTransitionOrderStatus("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionOrderStatus("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionOrderStatus("APPROVED", "ISSUED")).toBe(true);
    expect(canTransitionOrderStatus("ISSUED", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransitionOrderStatus("PARTIALLY_RECEIVED", "RECEIVED")).toBe(true);
    expect(canTransitionOrderStatus("RECEIVED", "CLOSED")).toBe(true);
  });

  it("lets a partly delivered order be closed short (PRD #19 §130)", () => {
    expect(canTransitionOrderStatus("PARTIALLY_RECEIVED", "CLOSED")).toBe(true);
  });

  it("refuses to issue an order nobody approved", () => {
    expect(canTransitionOrderStatus("DRAFT", "ISSUED")).toBe(false);
    expect(canTransitionOrderStatus("PENDING_APPROVAL", "ISSUED")).toBe(false);
  });

  it("cannot cancel an order that has already been delivered against", () => {
    // The transition exists for an issued order with nothing received; the
    // service adds the receipt check on top (PRD #19 §129).
    expect(canTransitionOrderStatus("ISSUED", "CANCELLED")).toBe(true);
    expect(canTransitionOrderStatus("RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransitionOrderStatus("PARTIALLY_RECEIVED", "CANCELLED")).toBe(false);
  });

  it("archives only what is finished (PRD #19 §131)", () => {
    expect(isOrderArchivable("DRAFT")).toBe(true);
    expect(isOrderArchivable("CLOSED")).toBe(true);
    expect(isOrderArchivable("CANCELLED")).toBe(true);
    expect(isOrderArchivable("ISSUED")).toBe(false);
    expect(isOrderArchivable("PARTIALLY_RECEIVED")).toBe(false);
  });

  it("freezes the lines once approved (PRD #19 §109)", () => {
    expect(isOrderEditable("DRAFT")).toBe(true);
    expect(isOrderEditable("REJECTED")).toBe(true);
    expect(isOrderEditable("APPROVED")).toBe(false);
    expect(isOrderEditable("ISSUED")).toBe(false);
  });

  it("takes goods only against an order the supplier was sent (PRD #19 §135)", () => {
    expect(acceptsReceipts("APPROVED")).toBe(false);
    expect(acceptsReceipts("ISSUED")).toBe(true);
    expect(acceptsReceipts("PARTIALLY_RECEIVED")).toBe(true);
    expect(acceptsReceipts("RECEIVED")).toBe(false);
    expect(acceptsReceipts("CLOSED")).toBe(false);
  });

  it("gives the archive no outgoing edge", () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransitionOrderStatus("ARCHIVED", status)).toBe(false);
    }
  });
});

describe("receipt status is derived from quantity (PRD #19 §141)", () => {
  it("stays issued while nothing has arrived", () => {
    expect(receiptStatusFor("ISSUED", 0)).toBe("ISSUED");
  });

  it("is partial while some has", () => {
    expect(receiptStatusFor("ISSUED", 0.01)).toBe("PARTIALLY_RECEIVED");
    expect(receiptStatusFor("ISSUED", 0.6)).toBe("PARTIALLY_RECEIVED");
    expect(receiptStatusFor("PARTIALLY_RECEIVED", 0.99)).toBe("PARTIALLY_RECEIVED");
  });

  it("is received once all of it has", () => {
    expect(receiptStatusFor("ISSUED", 1)).toBe("RECEIVED");
    // An over-delivery is still simply received.
    expect(receiptStatusFor("PARTIALLY_RECEIVED", 1.2)).toBe("RECEIVED");
  });

  it("never re-derives an order that is closed or cancelled", () => {
    expect(receiptStatusFor("CLOSED", 0.5)).toBe("CLOSED");
    expect(receiptStatusFor("CANCELLED", 1)).toBe("CANCELLED");
    expect(receiptStatusFor("DRAFT", 1)).toBe("DRAFT");
  });
});

describe("enquiry and quote lifecycles (PRD #19 §246, §247)", () => {
  it("issues, then closes or cancels", () => {
    expect(canTransitionRfqStatus("DRAFT", "ISSUED")).toBe(true);
    expect(canTransitionRfqStatus("ISSUED", "CLOSED")).toBe(true);
    expect(canTransitionRfqStatus("ISSUED", "CANCELLED")).toBe(true);
    expect(canTransitionRfqStatus("CLOSED", "ISSUED")).toBe(false);
  });

  it("fixes the lines once issued (PRD #19 §73)", () => {
    expect(isRfqEditable("DRAFT")).toBe(true);
    expect(isRfqEditable("ISSUED")).toBe(false);
  });

  it("takes quotes only while the enquiry is open", () => {
    expect(acceptsQuotes("DRAFT")).toBe(false);
    expect(acceptsQuotes("ISSUED")).toBe(true);
    expect(acceptsQuotes("CLOSED")).toBe(false);
  });

  it("lets only a received quote win (PRD #19 §92)", () => {
    expect(isQuoteSelectable("RECEIVED")).toBe(true);
    expect(isQuoteSelectable("DRAFT")).toBe(false);
    expect(isQuoteSelectable("DISQUALIFIED")).toBe(false);
    expect(isQuoteSelectable("SELECTED")).toBe(false);
  });

  it("does not reopen a decided quote", () => {
    expect(canTransitionQuoteStatus("SELECTED", "NOT_SELECTED")).toBe(false);
    expect(canTransitionQuoteStatus("DISQUALIFIED", "RECEIVED")).toBe(false);
    expect(canTransitionQuoteStatus("RECEIVED", "DISQUALIFIED")).toBe(true);
  });
});

describe("suppliers (PRD #19 §28)", () => {
  it("lets only an active supplier be named on new buying", () => {
    expect(isSupplierSelectable("ACTIVE")).toBe(true);
    expect(isSupplierSelectable("INACTIVE")).toBe(false);
    expect(isSupplierSelectable("ARCHIVED")).toBe(false);
  });
});

describe("money and quantity (PRD #19 §190–§194)", () => {
  it("prices a line as quantity × unit price, then taxes the subtotal", () => {
    const totals = lineTotals({ quantity: "10", unitPrice: "12.50", taxRate: "0.2" });
    expect(totals.subtotal.toString()).toBe("125");
    expect(totals.taxAmount.toString()).toBe("25");
    expect(totals.totalAmount.toString()).toBe("150");
  });

  it("rounds at the line, not at the end (PRD #19 §193)", () => {
    // Three lines that each round up a half-cent. Rounding once at the end
    // would give 0.99; rounding at each line gives 1.02, which is what the
    // column above the total actually says.
    const lines = [
      { quantity: "1", unitPrice: "0.335", taxRate: "0" },
      { quantity: "1", unitPrice: "0.335", taxRate: "0" },
      { quantity: "1", unitPrice: "0.335", taxRate: "0" },
    ];
    const totals = documentTotals(lines);
    expect(totals.subtotal.toString()).toBe("1.02");
  });

  it("sums already-computed lines without rounding twice", () => {
    const lines = [
      lineTotals({ quantity: "3", unitPrice: "19.99", taxRate: "0.2" }),
      lineTotals({ quantity: "2", unitPrice: "5.005", taxRate: "0.2" }),
    ];
    const summed = sumLineTotals(lines);
    const direct = documentTotals([
      { quantity: "3", unitPrice: "19.99", taxRate: "0.2" },
      { quantity: "2", unitPrice: "5.005", taxRate: "0.2" },
    ]);
    expect(summed.totalAmount.toString()).toBe(direct.totalAmount.toString());
  });

  it("handles a zero tax rate and a zero quantity line", () => {
    const zeroTax = lineTotals({ quantity: "4", unitPrice: "10", taxRate: "0" });
    expect(zeroTax.taxAmount.toString()).toBe("0");
    expect(zeroTax.totalAmount.toString()).toBe("40");
  });

  it("treats an unpriced request line as unpriced, not as free (PRD #19 §49)", () => {
    const total = estimatedTotal([
      { quantity: "10", estimatedUnitPrice: "5" },
      { quantity: "10", estimatedUnitPrice: null },
    ]);
    // 50, not 50 + 0 presented as if the second line were costed.
    expect(total.toString()).toBe("50");
  });

  it("prints quantities without trailing zeros", () => {
    expect(quantityString(new Prisma.Decimal("42.0000"))).toBe("42");
    expect(quantityString(new Prisma.Decimal("1.5000"))).toBe("1.5");
    expect(quantityString(new Prisma.Decimal("0.2500"))).toBe("0.25");
    expect(quantityString(null)).toBe("0");
  });

  it("counts days symmetrically", () => {
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    expect(daysBetween(day("2026-06-15"), day("2026-07-15"))).toBe(30);
    expect(daysBetween(day("2026-07-15"), day("2026-06-15"))).toBe(-30);
  });
});

describe("form-shaped input (PRD #19 §195)", () => {
  it("treats an unset category select as no category, not as an invalid one", () => {
    // An unset `<select>` posts "", not an absent key. Rejecting that would
    // make an optional dropdown impossible to leave alone.
    const unset = requestItemSchema.safeParse({
      description: "Rebar",
      quantity: "10",
      unit: "tonne",
      category: "",
    });
    expect(unset.success).toBe(true);
    if (unset.success) expect(unset.data.category).toBeUndefined();

    const chosen = requestItemSchema.safeParse({
      description: "Rebar",
      quantity: "10",
      unit: "tonne",
      category: "MATERIALS",
    });
    expect(chosen.success).toBe(true);

    const nonsense = requestItemSchema.safeParse({
      description: "Rebar",
      quantity: "10",
      unit: "tonne",
      category: "NOT_A_CATEGORY",
    });
    expect(nonsense.success).toBe(false);
  });

  it("refuses a quantity that is zero, negative or not a number", () => {
    for (const quantity of ["0", "-5", "abc", ""]) {
      const parsed = requestItemSchema.safeParse({
        description: "Rebar",
        quantity,
        unit: "tonne",
      });
      expect(parsed.success, `quantity ${quantity}`).toBe(false);
    }
  });

  it("accepts a comma as a decimal separator", () => {
    const parsed = requestItemSchema.safeParse({
      description: "Concrete",
      quantity: "12,5",
      unit: "m3",
      estimatedUnitPrice: "76,40",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quantity).toBe("12.5");
      expect(parsed.data.estimatedUnitPrice).toBe("76.40");
    }
  });

  it("refuses rejecting more than arrived (PRD #19 §138)", () => {
    const parsed = receiptSchema.safeParse({
      receiptDate: "2026-06-01",
      items: [{ purchaseOrderItemId: "x", receivedQuantity: "5", rejectedQuantity: "9" }],
    });
    expect(parsed.success).toBe(false);
  });
});
