import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { getUnitDetail, listUnitActivity } from "@/lib/modules/project-structure/structure.service";
import { deleteUnit } from "@/lib/modules/project-structure/structure.units";
import { archiveUnit, unpublishUnit } from "@/lib/modules/project-structure/unit-publishing.service";
import { listSalesInventory } from "@/lib/modules/sales/units/unit-sales.inventory";
import { commercialDetailsSchema, parseInventoryQuery, reserveSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import {
  addUnitToDeal,
  changeSaleStatus,
  correctReservation,
  extendReservation,
  getUnitSales,
  listDealUnits,
  markUnitSold,
  releaseReservation,
  removeUnitFromDeal,
  reopenSale,
  reserveUnit,
  updateCommercialDetails,
} from "@/lib/modules/sales/units/unit-sales.service";
import { getSalesSettings, updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Selling units against the real database (E-05E §59, §60).
 *
 * A building this suite adds to Marina Apartments (project_c), with published
 * apartments Sales may offer and a draft it may not. Reservations use the seeded
 * clients and deals of Company A, or create their own; everything a test makes —
 * units, reservations, prices, trails, clients and deals it opened — is removed.
 */

const COMPANY_A = "company_demo_a";
const MARINA = PROJECT.c;
const T = "E05E";
const ACME = "client_acme";
const ACME_DEAL = "opportunity_001"; // Riverside phase 2, NEGOTIATION, ACME
const BETA_DEAL = "opportunity_002"; // Beta Properties
const LOST_DEAL = "opportunity_008"; // Delta, LOST

let owner: UserContext;
let sales: UserContext;
let manager: UserContext;
let finance: UserContext;
let architect: UserContext;
let pm: UserContext;
let ownerB: UserContext;
let apartmentType: string;
let floorId: string;
let serial = 0;
let reservationDays: number;

async function cleanup() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: MARINA, nameKey: { startsWith: T } }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  const reservations = await prisma.unitReservation.findMany({ where: { unitId: { in: unitIds } }, select: { id: true } });
  await prisma.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
  await prisma.unitReservation.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.opportunityUnit.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
  const deals = await prisma.opportunity.findMany({ where: { companyId: COMPANY_A, name: { startsWith: T } }, select: { id: true } });
  const clients = await prisma.client.findMany({ where: { companyId: COMPANY_A, name: { startsWith: T } }, select: { id: true } });
  const trail = [...unitIds, ...deals.map((row) => row.id), ...clients.map((row) => row.id)];
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.opportunity.deleteMany({ where: { id: { in: deals.map((row) => row.id) } } });
  await prisma.contact.deleteMany({ where: { clientId: { in: clients.map((row) => row.id) } } });
  await prisma.client.deleteMany({ where: { id: { in: clients.map((row) => row.id) } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
}

async function refused(promise: Promise<unknown>, code: string, detail?: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}${detail ? ` / ${detail}` : ""}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  if (detail) expect((error as AccessError).details).toMatchObject({ code: detail });
  return error as AccessError;
}

/** A unit on the suite's floor; published unless said otherwise. */
async function newUnit(options: { published?: boolean; saleableArea?: string } = {}) {
  serial += 1;
  const code = `${T}-${String(serial).padStart(3, "0")}`;
  const unit = await prisma.projectUnit.create({
    data: {
      companyId: COMPANY_A,
      projectId: MARINA,
      floorId,
      unitCode: code,
      unitCodeKey: code,
      unitTypeId: apartmentType,
      saleableArea: options.saleableArea ?? "100.00",
      internalArea: "80.00",
      sortOrder: serial,
      createdBy: "test",
      publicationStatus: options.published === false ? "DRAFT" : "PUBLISHED",
    },
    select: { id: true, unitCode: true },
  });
  return unit;
}

async function onSale(unitId: string, price = "250000.00") {
  await updateCommercialDetails(sales, unitId, commercialDetailsSchema.parse({ askingPrice: price, currency: "EUR", priceBasis: "SALEABLE_AREA" }));
  await changeSaleStatus(sales, unitId, { action: "put_on_sale", reason: null });
}

const reserve = (context: UserContext, unitId: string, input: Record<string, unknown>) => reserveUnit(context, unitId, reserveSchema.parse(input));

beforeAll(async () => {
  [owner, sales, manager, finance, architect, pm] = await Promise.all((["OWNER", "SALES", "SALES_MANAGER", "FINANCE", "ARCHITECT", "PROJECT_MANAGER"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsMembership("member_owner_b");
  apartmentType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "APARTMENT" }, select: { id: true } })).id;
  reservationDays = (await prisma.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY_A }, select: { unitReservationDays: true } })).unitReservationDays;
  await cleanup();
});

beforeEach(async () => {
  const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY_A, projectId: MARINA, name: `${T} Sales Block`, nameKey: `${T} SALES BLOCK`, sortOrder: 90, createdBy: "test" } });
  floorId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: MARINA, buildingId: building.id, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "test" } })).id;
});

afterEach(cleanup);

afterAll(async () => {
  await prisma.companySettings.update({ where: { companyId: COMPANY_A }, data: { unitReservationDays: reservationDays } });
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Price and status ------------------------------------------------------------ */

describe("asking price and commercial status (§7-§12, §58)", () => {
  it("starts every unit Not For Sale, keeps the price history, and derives the price per m²", async () => {
    const unit = await newUnit({ saleableArea: "113.00" });
    expect((await getUnitSales(sales, unit.id)).status).toBe("NOT_FOR_SALE");
    expect((await getUnitDetail(architect, unit.id)).commercialStatus).toBe("NOT_FOR_SALE");

    await updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "285000", currency: "EUR", priceBasis: "SALEABLE_AREA" }));
    await updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "280000.00", currency: "EUR", priceBasis: "SALEABLE_AREA", reason: "Market review" }));
    const view = await getUnitSales(sales, unit.id);
    expect(view).toMatchObject({ askingPrice: "280000.00", currency: "EUR", pricePerSqm: "2477.88", basisArea: "113.00" });
    expect(view.priceHistory.map((row) => [row.oldPrice, row.newPrice, row.reason])).toEqual([
      ["285000.00", "280000.00", "Market review"],
      [null, "285000.00", null],
    ]);
    // Saving the same price again records nothing (§12).
    await updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "280000.00", currency: "EUR", priceBasis: "SALEABLE_AREA", salesNotes: "Corner, sea view" }));
    expect(await prisma.unitPriceHistory.count({ where: { unitId: unit.id } })).toBe(2);
    await updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "280000.00", currency: "EUR", priceBasis: "FIXED_UNIT_PRICE" }));
    expect((await getUnitSales(sales, unit.id)).pricePerSqm).toBeNull();
  });

  it("offers only a published, active unit for sale, holds with a reason, and moves back", async () => {
    const draft = await newUnit({ published: false });
    await refused(changeSaleStatus(sales, draft.id, { action: "put_on_sale", reason: null }), "CONFLICT", "UNIT_NOT_SELLABLE");

    const unit = await newUnit();
    await changeSaleStatus(sales, unit.id, { action: "put_on_sale", reason: null });
    await refused(changeSaleStatus(sales, unit.id, { action: "hold", reason: null }), "VALIDATION_ERROR");
    await changeSaleStatus(sales, unit.id, { action: "hold", reason: "Pricing review", holdUntil: new Date(Date.now() + 3 * 86_400_000) });
    const held = await getUnitSales(sales, unit.id);
    expect(held).toMatchObject({ status: "ON_HOLD", holdReason: "Pricing review", heldBy: expect.any(String) });
    await refused(changeSaleStatus(sales, unit.id, { action: "take_off_sale", reason: null }), "CONFLICT", "UNIT_COMMERCIAL_ILLEGAL_TRANSITION");
    await changeSaleStatus(sales, unit.id, { action: "release_hold", reason: null });
    await changeSaleStatus(sales, unit.id, { action: "take_off_sale", reason: null });
    const trail = (await getUnitSales(sales, unit.id)).statusHistory.map((row) => [row.fromStatus, row.toStatus]);
    expect(trail).toEqual([
      ["FOR_SALE", "NOT_FOR_SALE"],
      ["ON_HOLD", "FOR_SALE"],
      ["FOR_SALE", "ON_HOLD"],
      ["NOT_FOR_SALE", "FOR_SALE"],
    ]);
  });
});

/* Reservations ------------------------------------------------------------------ */

describe("reservations (§19-§27, §47-§50, §60)", () => {
  it("reserves for an existing client and deal, links the unit to the deal, and expires by the company default", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const before = Date.now();
    const result = await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL, agreedPrice: "278000" });
    const view = await getUnitSales(sales, unit.id);
    expect(view.status).toBe("RESERVED");
    expect(view.activeReservation).toMatchObject({ id: result.reservationId, client: { id: ACME, name: "ACME Developments" }, deal: { id: ACME_DEAL }, agreedPrice: "278000.00", currency: "EUR" });
    const expires = new Date(view.activeReservation!.expiresAt).getTime();
    expect(Math.abs(expires - (before + reservationDays * 86_400_000))).toBeLessThan(60_000);
    // Asking and agreed prices stay distinct (§30).
    expect(view.askingPrice).toBe("250000.00");
    expect(await prisma.opportunityUnit.findFirst({ where: { opportunityId: ACME_DEAL, unitId: unit.id } })).toMatchObject({ agreedPrice: expect.anything() });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: unit.id, actionKey: "UNIT_RESERVED" } })).not.toBeNull();
  });

  it("says what is missing, and refuses a deal of another client, a lost deal and a unit not for sale", async () => {
    const unit = await newUnit();
    const notForSale = await refused(reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL }), "CONFLICT", "UNIT_NOT_FOR_SALE");
    expect(notForSale.message).toContain("not for sale");
    await onSale(unit.id);
    expect((await refused(reserve(sales, unit.id, { opportunityId: ACME_DEAL }), "VALIDATION_ERROR")).message).toBe("Select a Client before reserving this Unit.");
    expect((await refused(reserve(sales, unit.id, { clientId: ACME }), "VALIDATION_ERROR")).message).toBe("Create or select a Deal before reserving this Unit.");
    expect((await refused(reserve(sales, unit.id, { clientId: ACME, opportunityId: BETA_DEAL }), "VALIDATION_ERROR")).message).toBe("That deal belongs to another client.");
    await refused(reserve(sales, unit.id, { clientId: "client_delta", opportunityId: LOST_DEAL }), "VALIDATION_ERROR");
    await refused(reserve(sales, unit.id, { clientId: "client_b_muc", opportunityId: ACME_DEAL }), "VALIDATION_ERROR");
    expect(await prisma.unitReservation.count({ where: { unitId: unit.id } })).toBe(0);
  });

  it("creates the client and the deal in the same step, and leaves neither behind when the reservation is refused", async () => {
    const unit = await newUnit();
    await onSale(unit.id, "190000.00");
    const result = await reserve(sales, unit.id, { newClient: { name: `${T} Jane Doe`, type: "INDIVIDUAL", email: "jane@example.test" }, newDeal: {}, agreedPrice: "185000" });
    const deal = await prisma.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } });
    expect(deal).toMatchObject({ clientId: result.clientId, stage: "NEGOTIATION", ownerMemberId: sales.membershipId, name: `${unit.unitCode} — ${T} Jane Doe` });
    expect(deal.estimatedValue.toFixed(2)).toBe("185000.00");

    // A client the company already has is offered back rather than created twice (§16, §62).
    const again = await newUnit();
    await onSale(again.id, "150000.00");
    const duplicate = await refused(reserve(sales, again.id, { newClient: { name: "ACME Developments", type: "COMPANY" }, newDeal: {} }), "CONFLICT");
    expect(duplicate.details).toEqual(expect.arrayContaining([expect.objectContaining({ id: ACME })]));
    expect(await prisma.client.count({ where: { companyId: COMPANY_A, normalizedName: "acme developments" } })).toBe(1);

    const blocked = await newUnit();
    await refused(reserve(sales, blocked.id, { newClient: { name: `${T} Nobody`, type: "INDIVIDUAL" }, newDeal: {} }), "CONFLICT", "UNIT_NOT_FOR_SALE");
    expect(await prisma.client.count({ where: { companyId: COMPANY_A, name: `${T} Nobody` } })).toBe(0);
  });

  it("lets exactly one of two people reserving at once succeed (§21, §50, §60)", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const outcomes = await Promise.allSettled([reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL }), reserve(manager, unit.id, { clientId: ACME, opportunityId: ACME_DEAL })]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: "CONFLICT", message: "This Unit has just been reserved by another user. Refresh to see the current status." });
    expect(await prisma.unitReservation.count({ where: { unitId: unit.id, status: "ACTIVE" } })).toBe(1);
  });

  it("extends with a later date and a reason, and releases with a reason, keeping the history", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const { reservationId } = await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL });
    const current = (await prisma.unitReservation.findUniqueOrThrow({ where: { id: reservationId } })).expiresAt;
    await prisma.unitReservation.update({ where: { id: reservationId }, data: { expiryWarnedAt: new Date() } });
    await refused(extendReservation(sales, reservationId, { expiresAt: new Date(current.getTime() - 3_600_000), reason: "Sooner" }), "VALIDATION_ERROR");
    const later = new Date(current.getTime() + 5 * 86_400_000);
    await extendReservation(sales, reservationId, { expiresAt: later, reason: "Waiting for the bank" });
    const extended = await prisma.unitReservation.findUniqueOrThrow({ where: { id: reservationId }, include: { extensions: true } });
    expect(extended.expiresAt.toISOString()).toBe(later.toISOString());
    expect(extended.expiryWarnedAt).toBeNull();
    expect(extended.extensions).toEqual([expect.objectContaining({ oldExpiresAt: current, newExpiresAt: later, reason: "Waiting for the bank" })]);

    await releaseReservation(manager, reservationId, { reason: "Client withdrew" });
    const view = await getUnitSales(sales, unit.id);
    expect(view).toMatchObject({ status: "FOR_SALE", activeReservation: null });
    expect(view.reservations[0]).toMatchObject({ id: reservationId, status: "RELEASED", closeReason: "Client withdrew" });
    await refused(releaseReservation(manager, reservationId, { reason: "Again" }), "CONFLICT", "RESERVATION_NOT_ACTIVE");
    // The salesperson who reserved hears about it; the manager who released it does not.
    const outbox = await prisma.notificationEventOutbox.findFirst({ where: { entityId: unit.id, eventType: "UNIT_RESERVATION_RELEASED" } });
    expect((outbox?.payloadJson as { memberIds: string[] }).memberIds).toEqual([sales.membershipId]);
  });

  it("keeps each unit of a multi-unit deal independent (§18)", async () => {
    const [apartment, parking] = [await newUnit(), await newUnit()];
    await onSale(apartment.id);
    await onSale(parking.id, "20000.00");
    const first = await reserve(sales, apartment.id, { clientId: ACME, opportunityId: ACME_DEAL, agreedPrice: "240000" });
    await reserve(sales, parking.id, { clientId: ACME, opportunityId: ACME_DEAL, agreedPrice: "18000" });
    expect((await listDealUnits(sales, ACME_DEAL)).map((row) => row.unitCode)).toEqual(expect.arrayContaining([apartment.unitCode, parking.unitCode]));
    await releaseReservation(sales, first.reservationId, { reason: "Kept the parking only" });
    expect((await getUnitSales(sales, parking.id)).status).toBe("RESERVED");
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: ACME_DEAL } })).stage).toBe("NEGOTIATION");
    await refused(removeUnitFromDeal(sales, ACME_DEAL, parking.id), "CONFLICT", "DEAL_UNIT_HELD");
    await removeUnitFromDeal(sales, ACME_DEAL, apartment.id);
    await addUnitToDeal(sales, ACME_DEAL, { unitId: apartment.id });
    await refused(addUnitToDeal(sales, ACME_DEAL, { unitId: apartment.id }), "CONFLICT", "DEAL_UNIT_EXISTS");
  });
});

/* The sale -------------------------------------------------------------------------- */

describe("marking Sold and reopening (§29-§31, §42, §60)", () => {
  it("needs an agreed price, converts the reservation, freezes the price, and reopens only with the elevated grant", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const { reservationId } = await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL });
    const missing = await refused(markUnitSold(sales, unit.id, {}), "VALIDATION_ERROR", "UNIT_NOT_SELLABLE_YET");
    expect(missing.message).toContain("An agreed price");
    expect((await getUnitSales(sales, unit.id)).soldCheck).toEqual({ allowed: false, missing: ["An agreed price"] });

    await refused(correctReservation(sales, reservationId, { agreedPrice: "245000", currency: "EUR", notes: null, reason: "Signed offer" }), "FORBIDDEN");
    await correctReservation(manager, reservationId, { agreedPrice: "245000", currency: "EUR", notes: null, reason: "Signed offer" });
    await markUnitSold(sales, unit.id, {});
    const sold = await getUnitSales(sales, unit.id);
    expect(sold).toMatchObject({ status: "SOLD", activeReservation: null, askingPrice: "250000.00" });
    expect(sold.reservations[0]).toMatchObject({ id: reservationId, status: "CONVERTED_TO_SALE", agreedPrice: "245000.00" });
    await refused(updateCommercialDetails(sales, unit.id, commercialDetailsSchema.parse({ askingPrice: "1", currency: "EUR", priceBasis: "SALEABLE_AREA" })), "CONFLICT", "UNIT_SOLD");

    await refused(reopenSale(sales, unit.id, { to: "FOR_SALE", reason: "Buyer walked away" }), "FORBIDDEN");
    const reopened = await reopenSale(manager, unit.id, { to: "RESERVED", reason: "Mortgage delayed", expiresAt: new Date(Date.now() + 10 * 86_400_000) });
    const back = await getUnitSales(sales, unit.id);
    expect(back.status).toBe("RESERVED");
    expect(back.activeReservation).toMatchObject({ id: reopened.reservationId, agreedPrice: "245000.00", client: { id: ACME } });
    expect(back.reservations.find((row) => row.id === reservationId)).toMatchObject({ status: "CANCELLED", closeReason: "Mortgage delayed" });
  });

  it("does not sell on a reservation past its expiry that the job has not closed yet, until it is extended (§24, §25)", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const { reservationId } = await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL, agreedPrice: "240000" });
    await prisma.unitReservation.update({ where: { id: reservationId }, data: { reservedAt: new Date(Date.now() - 3 * 86_400_000), expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await refused(markUnitSold(sales, unit.id, {}), "VALIDATION_ERROR", "UNIT_NOT_SELLABLE_YET");
    expect(expired.message).toContain("A reservation that has not expired");
    await extendReservation(sales, reservationId, { expiresAt: new Date(Date.now() + 2 * 86_400_000), reason: "Signing tomorrow" });
    expect((await markUnitSold(sales, unit.id, {})).status).toBe("SOLD");
  });

  it("refuses to take a unit on sale out of publication, and to delete a unit with a sales history", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    const version = (await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id } })).version;
    const owned = await loginAs("ARCHITECTURE_MANAGER");
    await refused(unpublishUnit(owned, unit.id, { reason: "x", expectedVersion: version }), "CONFLICT", "UNIT_ON_SALE");
    await refused(archiveUnit(owned, unit.id, { expectedVersion: version }), "CONFLICT", "UNIT_ON_SALE");
    await changeSaleStatus(sales, unit.id, { action: "take_off_sale", reason: null });
    await refused(deleteUnit(owner, unit.id), "CONFLICT", "UNIT_REFERENCED");
  });
});

/* Access, inventory, settings --------------------------------------------------------- */

describe("access (§32, §38, §39, §46, §67)", () => {
  it("shows the status to everybody who reads the unit, and prices, clients and deals only with Sales' grant", async () => {
    const unit = await newUnit();
    await onSale(unit.id);
    await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL });
    expect((await getUnitDetail(architect, unit.id)).commercialStatus).toBe("RESERVED");
    await refused(getUnitSales(architect, unit.id), "FORBIDDEN");
    expect((await listUnitActivity(architect, unit.id)).items.map((row) => row.action)).not.toContain("UNIT_RESERVED");
    expect((await listUnitActivity(sales, unit.id)).items.map((row) => row.action)).toContain("UNIT_RESERVED");

    const view = await getUnitSales(finance, unit.id);
    expect(view.capabilities).toMatchObject({ canView: true, canReserve: false, canManagePrice: false, canMarkSold: false });
    const withoutClients = { ...finance, permissions: finance.permissions.filter((permission) => permission !== "client.view") };
    expect((await getUnitSales(withoutClients, unit.id)).activeReservation).toMatchObject({ client: null });
    await refused(changeSaleStatus(finance, unit.id, { action: "take_off_sale", reason: null }), "FORBIDDEN");

    // The Project Manager may read sales, but Marina is not one of their projects; Company B finds nothing.
    await refused(getUnitSales(pm, unit.id), "NOT_FOUND");
    await refused(getUnitSales(ownerB, unit.id), "NOT_FOUND");
    await refused(reserve(ownerB, unit.id, { clientId: "client_b_muc", newDeal: {} }), "NOT_FOUND");
  });

  it("filters, searches and counts the inventory in the database, clients included only where visible (§13, §14)", async () => {
    const cheap = await newUnit({ saleableArea: "100.00" });
    const dear = await newUnit({ saleableArea: "100.00" });
    const idle = await newUnit();
    await onSale(cheap.id, "150000.00");
    await onSale(dear.id, "400000.00");
    await reserve(sales, dear.id, { clientId: ACME, opportunityId: ACME_DEAL });
    const inventory = (query: Record<string, string>, context = sales) => listSalesInventory(context, MARINA, parseInventoryQuery({ q: T, ...query }));

    const all = await inventory({});
    expect(all.items.map((row) => row.id)).toEqual([cheap.id, dear.id, idle.id]);
    expect(all.counts).toMatchObject({ ALL: 3, FOR_SALE: 1, RESERVED: 1, NOT_FOR_SALE: 1 });
    expect((await inventory({ commercialStatus: "RESERVED" })).items.map((row) => row.id)).toEqual([dear.id]);
    expect((await inventory({ pricePerSqmMin: "2000" })).items.map((row) => row.id)).toEqual([dear.id]);
    expect((await inventory({ sort: "-price" })).items[0]!.id).toBe(dear.id);
    const row = (await inventory({ commercialStatus: "RESERVED" })).items[0]!;
    expect(row).toMatchObject({ pricePerSqm: "4000.00", client: { name: "ACME Developments" } });
    expect((await listSalesInventory(sales, MARINA, parseInventoryQuery({ q: "ACME Dev" }))).items.map((item) => item.id)).toContain(dear.id);

    const noClients = { ...sales, permissions: sales.permissions.filter((permission) => permission !== "client.view") };
    expect((await listSalesInventory(noClients, MARINA, parseInventoryQuery({ q: "ACME Dev" }))).items.map((item) => item.id)).not.toContain(dear.id);
    await refused(listSalesInventory(architect, MARINA, parseInventoryQuery({})), "FORBIDDEN");
  });

  it("uses the company's reservation length, which only company settings may change (§24)", async () => {
    await refused(updateSalesSettings(sales, { unitReservationDays: 3 }), "FORBIDDEN");
    await updateSalesSettings(owner, { unitReservationDays: 3 });
    expect((await getSalesSettings(owner)).unitReservationDays).toBe(3);
    const unit = await newUnit();
    await onSale(unit.id);
    const before = Date.now();
    await reserve(sales, unit.id, { clientId: ACME, opportunityId: ACME_DEAL });
    const expires = (await prisma.unitReservation.findFirstOrThrow({ where: { unitId: unit.id } })).expiresAt.getTime();
    expect(Math.abs(expires - (before + 3 * 86_400_000))).toBeLessThan(60_000);
    expect(await prisma.auditEvent.findFirst({ where: { actionKey: "COMPANY_SALES_SETTINGS_UPDATED", companyId: COMPANY_A }, orderBy: { occurredAt: "desc" } })).toMatchObject({ actionKey: "COMPANY_SALES_SETTINGS_UPDATED" });
  });
});
