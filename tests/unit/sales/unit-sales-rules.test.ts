import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { canMove } from "@/lib/core/state/machine";
import { STATE_MACHINES } from "@/lib/core/state/registry";
import { unitCommercialMachine } from "@/lib/modules/sales/units/unit-commercial.machine";
import { canMarkUnitSold, defaultExpiry, moneyText, pricePerSqm, sellability } from "@/lib/modules/sales/units/unit-sales.rules";
import { commercialDetailsSchema, extendReservationSchema, parseInventoryQuery, releaseReservationSchema, reopenSaleSchema, reserveSchema } from "@/lib/modules/sales/units/unit-sales.schema";

/**
 * Unit sales rules, without a database (E-05E §6-§12, §29, §38, §39, §47, §59).
 */

const areas = { saleableArea: "113.00", internalArea: "92.40", grossArea: null };

describe("price per square metre (§10)", () => {
  it("divides the asking price by the area its basis names, to the cent", () => {
    expect(pricePerSqm("185000.00", "SALEABLE_AREA", areas)).toBe("1637.17");
    expect(pricePerSqm("185000.00", "INTERNAL_AREA", areas)).toBe("2002.16");
    expect(pricePerSqm("100.00", "SALEABLE_AREA", { saleableArea: "3.00" })).toBe("33.33");
    expect(pricePerSqm("200.00", "SALEABLE_AREA", { saleableArea: "3.00" })).toBe("66.67");
  });

  it("has none for a fixed price, a missing price, or a missing or zero area", () => {
    expect(pricePerSqm("185000.00", "FIXED_UNIT_PRICE", areas)).toBeNull();
    expect(pricePerSqm(null, "SALEABLE_AREA", areas)).toBeNull();
    expect(pricePerSqm("185000.00", "GROSS_AREA", areas)).toBeNull();
    expect(pricePerSqm("185000.00", "SALEABLE_AREA", { saleableArea: "0.00" })).toBeNull();
  });

  it("changes with the asking price (§60 Price)", () => {
    expect(pricePerSqm("179000.00", "SALEABLE_AREA", areas)).toBe("1584.07");
    expect(pricePerSqm("185000.00", "SALEABLE_AREA", areas)).not.toBe(pricePerSqm("179000.00", "SALEABLE_AREA", areas));
  });
});

describe("eligibility and the Sold check (§6, §22, §29)", () => {
  it("offers only active, published units", () => {
    expect(sellability({ isActive: true, publicationStatus: "PUBLISHED" })).toEqual({ sellable: true, reason: null });
    expect(sellability({ isActive: true, publicationStatus: "READY_FOR_PUBLISHING" })).toEqual({ sellable: false, reason: "This Unit is not published for Sales use." });
    expect(sellability({ isActive: true, publicationStatus: "DRAFT" }).sellable).toBe(false);
    expect(sellability({ isActive: false, publicationStatus: "PUBLISHED" }).sellable).toBe(false);
  });

  const reservation = { status: "ACTIVE", clientId: "client_acme", opportunityId: "opportunity_001", agreedPrice: "126500.00" };

  it("allows Sold for a reserved unit with an active reservation, a client, a deal and an agreed price", () => {
    expect(canMarkUnitSold({ status: "RESERVED", reservation })).toEqual({ allowed: true, missing: [], rule: "RESERVATION" });
  });

  it("names everything missing", () => {
    expect(canMarkUnitSold({ status: "FOR_SALE", reservation: null })).toEqual({ allowed: false, missing: ["A reserved unit", "An active reservation"], rule: "RESERVATION" });
    expect(canMarkUnitSold({ status: "RESERVED", reservation: { ...reservation, status: "EXPIRED" } }).missing).toEqual(["An active reservation"]);
    expect(canMarkUnitSold({ status: "RESERVED", reservation: { ...reservation, agreedPrice: null } }).missing).toEqual(["An agreed price"]);
    expect(canMarkUnitSold({ status: "RESERVED", reservation: { ...reservation, clientId: null, opportunityId: null } }).missing).toEqual(["A client", "A deal"]);
    // Past its expiry and not yet closed by the job, a reservation is over (§24, §25).
    const now = new Date("2026-09-17T12:00:00.000Z");
    expect(canMarkUnitSold({ status: "RESERVED", reservation: { ...reservation, expiresAt: "2026-09-17T11:59:00.000Z" }, now }).missing).toEqual(["A reservation that has not expired"]);
    expect(canMarkUnitSold({ status: "RESERVED", reservation: { ...reservation, expiresAt: "2026-09-18T12:00:00.000Z" }, now }).allowed).toBe(true);
  });

  it("defaults a reservation's end to whole days from now, and keeps money as two-decimal text", () => {
    const now = new Date("2026-09-17T08:00:00.000Z");
    expect(defaultExpiry(now, 7).toISOString()).toBe("2026-09-24T08:00:00.000Z");
    expect(moneyText({ toFixed: (digits: number) => (126500).toFixed(digits) })).toBe("126500.00");
    expect(moneyText(null)).toBeNull();
  });
});

describe("the commercial machine (§7, §8)", () => {
  it("is registered, and moves only along the table", () => {
    expect(STATE_MACHINES).toContain(unitCommercialMachine);
    expect(canMove(unitCommercialMachine, "NOT_FOR_SALE", "FOR_SALE")).toBe(true);
    expect(canMove(unitCommercialMachine, "FOR_SALE", "RESERVED")).toBe(true);
    expect(canMove(unitCommercialMachine, "ON_HOLD", "RESERVED")).toBe(true);
    expect(canMove(unitCommercialMachine, "RESERVED", "SOLD")).toBe(true);
    expect(canMove(unitCommercialMachine, "SOLD", "RESERVED")).toBe(true);
    // Never straight to Sold, never from Not For Sale to Reserved, and a sale is not undone by a hold.
    expect(canMove(unitCommercialMachine, "FOR_SALE", "SOLD")).toBe(false);
    expect(canMove(unitCommercialMachine, "NOT_FOR_SALE", "RESERVED")).toBe(false);
    expect(canMove(unitCommercialMachine, "SOLD", "ON_HOLD")).toBe(false);
    expect(canMove(unitCommercialMachine, "SOLD", "NOT_FOR_SALE")).toBe(false);
  });

  it("asks for a reason to hold, release a reservation and reopen a sale", () => {
    const reasoned = unitCommercialMachine.transitions.filter((transition) => transition.requiresReason).map((transition) => transition.action).sort();
    expect(reasoned).toEqual(["hold", "release_reservation", "reopen"]);
  });
});

describe("validation (§47)", () => {
  it("keeps money as text with at most two decimals, never negative", () => {
    expect(commercialDetailsSchema.parse({ askingPrice: "185000,5", priceBasis: "SALEABLE_AREA" }).askingPrice).toBe("185000.5");
    expect(commercialDetailsSchema.parse({ askingPrice: "", priceBasis: "SALEABLE_AREA" }).askingPrice).toBeNull();
    expect(commercialDetailsSchema.safeParse({ askingPrice: "-1", priceBasis: "SALEABLE_AREA" }).success).toBe(false);
    expect(commercialDetailsSchema.safeParse({ askingPrice: "10.123", priceBasis: "SALEABLE_AREA" }).success).toBe(false);
    expect(commercialDetailsSchema.safeParse({ askingPrice: "10", currency: "XYZ", priceBasis: "SALEABLE_AREA" }).success).toBe(false);
  });

  it("needs a reason to release, extend and reopen, and a date to extend", () => {
    expect(releaseReservationSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(extendReservationSchema.safeParse({ reason: "Board meets Thursday" }).success).toBe(false);
    expect(extendReservationSchema.safeParse({ reason: "Board meets Thursday", expiresAt: "2026-10-01T00:00:00.000Z" }).success).toBe(true);
    expect(reopenSaleSchema.safeParse({ to: "SOLD", reason: "x" }).success).toBe(false);
  });

  it("accepts a new client with a similar-client confirmation, and rejects a bad email", () => {
    expect(reserveSchema.parse({ newClient: { name: "Jane Doe", acceptDuplicate: true }, newDeal: {} }).newClient).toMatchObject({ name: "Jane Doe", type: "INDIVIDUAL", acceptDuplicate: true });
    expect(reserveSchema.safeParse({ newClient: { name: "Jane Doe", email: "not-an-email" }, newDeal: {} }).success).toBe(false);
  });

  it("reads the inventory query forgivingly: unknown values fall away, the page size defaults to 50", () => {
    expect(parseInventoryQuery({ commercialStatus: "RESERVED", sort: "-price", priceMin: "100000", page: "2" })).toMatchObject({ commercialStatus: "RESERVED", sort: "-price", priceMin: "100000", page: 2, limit: 50 });
    expect(parseInventoryQuery({ commercialStatus: "GONE", sort: "sideways", priceMin: "-5", limit: "5000" })).toEqual({ page: 1, limit: 50 });
  });
});

describe("default role policy (§38, §39)", () => {
  const holders = (permission: string) => ROLE_KEYS.filter((role) => (permissionsForRole(role) as readonly string[]).includes(permission)).sort();

  it("lets Sales price, hold, reserve, extend, release and sell", () => {
    for (const permission of ["project.unit.sales_status.manage", "project.unit.price.manage", "project.unit.reserve", "project.unit.reservation.extend", "project.unit.reservation.release", "project.unit.mark_sold"]) {
      expect(holders(permission), permission).toEqual(["ADMIN", "OWNER", "SALES", "SALES_MANAGER"]);
    }
  });

  it("keeps reopening a sale and correcting a reservation with the Sales Manager, the Admin and the Owner", () => {
    for (const permission of ["project.unit.reopen_sale", "project.unit.sales_correct"]) {
      expect(holders(permission), permission).toEqual(["ADMIN", "OWNER", "SALES_MANAGER"]);
    }
  });

  it("shows sales to management, Finance, Legal, the Project Manager and the Viewer, and not to Architecture or Engineering", () => {
    expect(holders("project.unit.sales.view")).toEqual(["ADMIN", "CEO", "FINANCE", "LEGAL", "OWNER", "PROJECT_MANAGER", "SALES", "SALES_MANAGER", "VIEWER"]);
    for (const role of ["ARCHITECT", "ARCHITECTURE_MANAGER", "ENGINEER"] as const) {
      expect((permissionsForRole(role) as readonly string[]).filter((permission) => permission.startsWith("project.unit.sales")), role).toEqual([]);
    }
  });

  it("never lets a role act on a sale it cannot see", () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role) as readonly string[];
      const acts = granted.some((permission) => /^project\.unit\.(sales_status|price|reserve|reservation|mark_sold|reopen_sale|sales_correct)\b/.test(permission));
      if (acts) expect(granted.includes("project.unit.sales.view"), role).toBe(true);
    }
  });
});
