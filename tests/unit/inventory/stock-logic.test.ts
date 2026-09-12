import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  formatQuantity,
  formatSigned,
  withUnit,
} from "@/components/inventory/inventory-format";
import {
  QUANTITY_DP,
  isPositive,
  quantity,
  quantityString,
  sum,
  toStoredQuantity,
} from "@/lib/modules/inventory/inventory.quantity";
import {
  adjustmentReasonLabels,
  allowsNegativeResult,
  daysBetween,
  isReservationHolding,
  isTransactionCancellable,
  isTransactionEditable,
  isTransactionPostable,
  isTransactionReversible,
  needsAttention,
  stockLevelFor,
} from "@/lib/modules/inventory/inventory.status";
import {
  adjustmentSchema,
  itemSchema,
  reservationSchema,
  transferSchema,
  warehouseSchema,
} from "@/lib/modules/inventory/inventory.schema";

/**
 * Inventory logic, tested without a database (PRD #20 §377).
 *
 * Quantities are decimals end to end. The point of these tests is that no
 * arithmetic anywhere in the module goes through a JavaScript float, because a
 * stock figure that has been silently rounded is one nobody can reconcile
 * against the ledger (PRD #20 §242).
 */

describe("decimal quantities (PRD #20 §72, §241, §377)", () => {
  it("keeps four decimal places, and no more", () => {
    expect(QUANTITY_DP).toBe(4);
    expect(quantityString(quantity("12.3456"))).toBe("12.3456");
    // Trailing zeros are noise on a quantity: "42", not "42.0000" (§272).
    expect(quantityString(quantity("42.0000"))).toBe("42");
  });

  it("adds without floating-point drift", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. It must here.
    const total = quantity("0.1").plus(quantity("0.2"));
    expect(total.equals(new Prisma.Decimal("0.3"))).toBe(true);
    expect(quantityString(total)).toBe("0.3");
  });

  it("sums a column exactly", () => {
    const values = ["1.0001", "2.0002", "3.0003"].map((value) => quantity(value));
    expect(quantityString(sum(values))).toBe("6.0006");
  });

  it("treats a missing quantity as zero rather than NaN", () => {
    expect(quantityString(null)).toBe("0");
    expect(quantityString(undefined)).toBe("0");
    expect(quantityString(sum([null, undefined, quantity("5")]))).toBe("5");
  });

  it("rounds to storage precision once, on the way in", () => {
    expect(quantityString(toStoredQuantity("1.00005"))).toBe("1.0001");
    expect(quantityString(toStoredQuantity("1.00004"))).toBe("1");
  });

  it("knows what counts as a positive movement", () => {
    expect(isPositive(quantity("0.0001"))).toBe(true);
    expect(isPositive(quantity("0"))).toBe(false);
    expect(isPositive(quantity("-1"))).toBe(false);
  });
});

describe("stock levels (PRD #20 §167–§169)", () => {
  it("reports nothing on hand as out of stock, whatever the thresholds say", () => {
    expect(stockLevelFor({ onHand: 0, minimumStock: null, reorderPoint: null })).toBe(
      "OUT_OF_STOCK",
    );
    expect(stockLevelFor({ onHand: 0, minimumStock: 10, reorderPoint: 20 })).toBe("OUT_OF_STOCK");
  });

  it("never invents a threshold the company did not choose (§168)", () => {
    expect(stockLevelFor({ onHand: 3, minimumStock: null, reorderPoint: null })).toBe(
      "NOT_TRACKED",
    );
  });

  it("puts the minimum below the reorder point", () => {
    // At or below the minimum is the harder floor and wins over "low".
    expect(stockLevelFor({ onHand: 10, minimumStock: 10, reorderPoint: 20 })).toBe(
      "BELOW_MINIMUM",
    );
    expect(stockLevelFor({ onHand: 15, minimumStock: 10, reorderPoint: 20 })).toBe("LOW");
    expect(stockLevelFor({ onHand: 21, minimumStock: 10, reorderPoint: 20 })).toBe("OK");
  });

  it("works with only one threshold set (§168)", () => {
    expect(stockLevelFor({ onHand: 5, minimumStock: null, reorderPoint: 10 })).toBe("LOW");
    expect(stockLevelFor({ onHand: 5, minimumStock: 10, reorderPoint: null })).toBe(
      "BELOW_MINIMUM",
    );
  });

  it("knows which levels somebody has to act on", () => {
    expect(needsAttention("OUT_OF_STOCK")).toBe(true);
    expect(needsAttention("BELOW_MINIMUM")).toBe(true);
    expect(needsAttention("LOW")).toBe(true);
    expect(needsAttention("OK")).toBe(false);
    expect(needsAttention("NOT_TRACKED")).toBe(false);
  });
});

describe("document lifecycle (PRD #20 §280, §281)", () => {
  it("only a draft may be edited, posted or cancelled", () => {
    for (const status of ["POSTED", "CANCELLED", "REVERSED"] as const) {
      expect(isTransactionEditable(status)).toBe(false);
      expect(isTransactionPostable(status)).toBe(false);
      expect(isTransactionCancellable(status)).toBe(false);
    }

    expect(isTransactionEditable("DRAFT")).toBe(true);
    expect(isTransactionPostable("DRAFT")).toBe(true);
    expect(isTransactionCancellable("DRAFT")).toBe(true);
  });

  it("only a posted document may be reversed (§99, §100)", () => {
    expect(isTransactionReversible("POSTED")).toBe(true);
    expect(isTransactionReversible("DRAFT")).toBe(false);
    expect(isTransactionReversible("REVERSED")).toBe(false);
    expect(isTransactionReversible("CANCELLED")).toBe(false);
  });

  it("cancelling and reversing are never both available", () => {
    for (const status of ["DRAFT", "POSTED", "CANCELLED", "REVERSED"] as const) {
      expect(isTransactionCancellable(status) && isTransactionReversible(status)).toBe(false);
    }
  });

  it("lets only an opening balance create stock from nothing (§149)", () => {
    expect(allowsNegativeResult("OPENING_BALANCE")).toBe(true);
    for (const reason of ["PHYSICAL_COUNT", "DAMAGE", "LOSS", "FOUND", "CORRECTION", "OTHER"] as const) {
      expect(allowsNegativeResult(reason)).toBe(false);
    }
  });

  it("labels every adjustment reason", () => {
    for (const reason of Object.keys(adjustmentReasonLabels)) {
      expect(adjustmentReasonLabels[reason as keyof typeof adjustmentReasonLabels]).toBeTruthy();
    }
  });
});

describe("reservations (PRD #20 §154, §166)", () => {
  it("only an active or partly fulfilled reservation still holds stock back", () => {
    expect(isReservationHolding("ACTIVE")).toBe(true);
    expect(isReservationHolding("PARTIALLY_FULFILLED")).toBe(true);

    for (const status of ["FULFILLED", "RELEASED", "CANCELLED", "EXPIRED"] as const) {
      expect(isReservationHolding(status)).toBe(false);
    }
  });

  it("counts whole days between dates, ignoring the time of day", () => {
    const monday = new Date("2026-09-07T23:30:00Z");
    const tuesday = new Date("2026-09-08T00:30:00Z");
    expect(daysBetween(monday, tuesday)).toBe(1);
    expect(daysBetween(tuesday, monday)).toBe(-1);
  });
});

describe("validation (PRD #20 §273–§279)", () => {
  it("refuses a reorder point below the minimum (§168)", () => {
    const parsed = itemSchema.safeParse({
      sku: "MAT-X",
      name: "Test item",
      category: "MATERIAL",
      baseUnit: "bag",
      minimumStock: "20",
      reorderPoint: "10",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.reorderPoint?.[0]).toMatch(/at or above/i);
    }
  });

  it("accepts a reorder point at the minimum", () => {
    const parsed = itemSchema.safeParse({
      sku: "MAT-X",
      name: "Test item",
      category: "MATERIAL",
      baseUnit: "bag",
      minimumStock: "20",
      reorderPoint: "20",
    });
    expect(parsed.success).toBe(true);
  });

  it("takes a comma as a decimal separator", () => {
    const parsed = itemSchema.safeParse({
      sku: "MAT-X",
      name: "Test item",
      category: "MATERIAL",
      baseUnit: "bag",
      minimumStock: "12,5",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.minimumStock).toBe("12.5");
  });

  it("refuses more than four decimal places (§72)", () => {
    const parsed = adjustmentSchema.safeParse({
      warehouseId: "wh_1",
      adjustmentDate: "2026-09-12",
      reason: "CORRECTION",
      lines: [{ inventoryItemId: "i", locationId: "l", quantityDelta: "1.00001" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an adjustment of zero, which changes nothing (§147)", () => {
    const parsed = adjustmentSchema.safeParse({
      warehouseId: "wh_1",
      adjustmentDate: "2026-09-12",
      reason: "CORRECTION",
      lines: [{ inventoryItemId: "i", locationId: "l", quantityDelta: "0" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a negative adjustment, which writes stock off (§147)", () => {
    const parsed = adjustmentSchema.safeParse({
      warehouseId: "wh_1",
      adjustmentDate: "2026-09-12",
      reason: "DAMAGE",
      lines: [{ inventoryItemId: "i", locationId: "l", quantityDelta: "-2.5" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a quantity of zero or less on a movement (§72)", () => {
    for (const value of ["0", "-1"]) {
      const parsed = reservationSchema.safeParse({
        inventoryItemId: "i",
        warehouseId: "w",
        locationId: "l",
        quantity: value,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("refuses a document with no lines at all", () => {
    const parsed = transferSchema.safeParse({
      fromWarehouseId: "a",
      toWarehouseId: "b",
      transferDate: "2026-09-12",
      lines: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a project-site warehouse with no project (§53)", () => {
    const parsed = warehouseSchema.safeParse({
      code: "WH-X",
      name: "Site store",
      warehouseType: "PROJECT_SITE",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.projectId?.[0]).toMatch(/needs a project/i);
    }
  });

  it("accepts an unset optional select, which posts as an empty string", () => {
    // An HTML <select> with nothing chosen posts "", not undefined. Refusing it
    // would make "General issue" impossible to choose on a form.
    const parsed = warehouseSchema.safeParse({
      code: "WH-X",
      name: "Central store",
      warehouseType: "CENTRAL",
      projectId: "",
      description: "",
      address: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.projectId).toBeUndefined();
  });

  it("never lets a schema set a status directly (§280)", () => {
    // Documents move through named actions, so there is nothing for a generic
    // update to set.
    const parsed = transferSchema.safeParse({
      fromWarehouseId: "a",
      toWarehouseId: "b",
      transferDate: "2026-09-12",
      status: "POSTED",
      lines: [
        { inventoryItemId: "i", fromLocationId: "x", toLocationId: "y", quantity: "1" },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect("status" in parsed.data).toBe(false);
  });
});

describe("presentation (PRD #20 §328, §329)", () => {
  it("trims trailing zeros without rounding the value", () => {
    expect(formatQuantity("12.0000")).toBe("12");
    expect(formatQuantity("12.5000")).toBe("12.5");
    expect(formatQuantity("0.0001")).toBe("0.0001");
  });

  it("groups thousands", () => {
    expect(formatQuantity("1234567.2500")).toBe("1,234,567.25");
  });

  it("says nothing rather than zero when there is no figure", () => {
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
    expect(formatQuantity("")).toBe("—");
  });

  it("keeps the unit with the quantity, because a bare number means nothing", () => {
    expect(withUnit("40.0000", "tonne")).toBe("40 tonne");
    expect(withUnit(null, "tonne")).toBe("—");
  });

  it("shows direction on a signed quantity (§71)", () => {
    expect(formatSigned("-118.0000", "m3")).toBe("−118 m3");
    expect(formatSigned("42.0000", "tonne")).toBe("+42 tonne");
  });
});
