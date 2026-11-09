import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { listProjectUnits, listProjectUnitSelection } from "@/lib/modules/project-structure/structure.service";
import { updateUnit } from "@/lib/modules/project-structure/structure.units";
import { unitBulkSchema } from "@/lib/modules/project-structure/unit-bulk.schema";
import { runStructureBulk } from "@/lib/modules/project-structure/unit-bulk.service";
import { runSalesBulk } from "@/lib/modules/sales/units/unit-sales.bulk";
import { listSalesSelection } from "@/lib/modules/sales/units/unit-sales.inventory";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * Ticking units and changing them together (2026-11-09), against the real
 * database: every unit goes through its own page's service, so each keeps its
 * permission, company, project and version checks, publishes its next version,
 * and is skipped — named, with the reason — when it cannot take the change.
 *
 * A building this suite adds to Riverside Residences (project_a), removed after
 * every test with everything its units gathered.
 */

const COMPANY_A = COMPANY.a;
const RIVERSIDE = PROJECT.a;
const T = "BULK";
const CODE = "BK";

let owner: UserContext;
let pm: UserContext;
let sales: UserContext;
let architect: UserContext;
let apartmentType: string;
let parkingType: string;
let floorId: string;
let otherFloorId: string;
let serial = 0;

async function cleanup() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: RIVERSIDE, nameKey: { startsWith: T } }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  await prisma.unitReservation.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null } });
  await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: unitIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...unitIds, ...floors.map((row) => row.id)] } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...unitIds, ...floors.map((row) => row.id)] } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floors.map((row) => row.id) } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildings.map((row) => row.id) } } });
}

async function refused(promise: Promise<unknown>, code: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  return error as AccessError;
}

/** A published unit on the suite's floor; areas and a sales record as asked. */
async function newUnit(options: { floor?: string; type?: string; saleableArea?: string | null; grossArea?: string | null; internalArea?: string | null; bedrooms?: number | null; description?: string; archived?: boolean; status?: "NOT_FOR_SALE" | "FOR_SALE" | "RESERVED" | "SOLD"; price?: string; notes?: string } = {}) {
  serial += 1;
  const code = `${String(500 + serial)}`;
  const unit = await prisma.projectUnit.create({
    data: {
      companyId: COMPANY_A,
      projectId: RIVERSIDE,
      floorId: options.floor ?? floorId,
      unitCode: code,
      unitCodeKey: code,
      unitTypeId: options.type ?? apartmentType,
      saleableArea: options.saleableArea === undefined ? "100.00" : options.saleableArea,
      grossArea: options.grossArea ?? null,
      internalArea: options.internalArea === undefined ? "80.00" : options.internalArea,
      bedrooms: options.bedrooms === undefined ? 2 : options.bedrooms,
      description: options.description ?? null,
      sortOrder: serial,
      createdBy: "test",
      publicationStatus: options.archived ? "ARCHIVED" : "PUBLISHED",
    },
    select: { id: true, unitCode: true, version: true },
  });
  if (options.status || options.price || options.notes) {
    await prisma.unitCommercialProfile.create({
      data: { companyId: COMPANY_A, projectId: RIVERSIDE, unitId: unit.id, status: options.status ?? "NOT_FOR_SALE", askingPrice: options.price ?? null, currency: options.price ? "EUR" : null, salesNotes: options.notes ?? null },
    });
  }
  return unit;
}

async function salesVersion(unitId: string): Promise<number> {
  return (await prisma.unitCommercialProfile.findFirst({ where: { unitId }, select: { version: true } }))?.version ?? 0;
}

const bulk = (input: unknown) => unitBulkSchema.parse(input);
const structure = (context: UserContext, input: unknown) => runStructureBulk(context, RIVERSIDE, bulk(input) as Parameters<typeof runStructureBulk>[2]);
const selling = (context: UserContext, input: unknown) => runSalesBulk(context, RIVERSIDE, bulk(input) as Parameters<typeof runSalesBulk>[2]);

beforeAll(async () => {
  [owner, pm, sales, architect] = await Promise.all((["OWNER", "PROJECT_MANAGER", "SALES", "ARCHITECT"] as const).map((role) => loginAs(role)));
  apartmentType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "APARTMENT" }, select: { id: true } })).id;
  parkingType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "PARKING" }, select: { id: true } })).id;
  await cleanup();
});

beforeEach(async () => {
  const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, name: `${T} Block`, nameKey: `${T} BLOCK`, code: CODE, codeKey: CODE, sortOrder: 91, createdBy: "test" } });
  floorId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 5, name: "Floor 5", floorKey: "STANDARD:5", sortOrder: 1, createdBy: "test" } })).id;
  otherFloorId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 6, name: "Floor 6", floorKey: "STANDARD:6", sortOrder: 2, createdBy: "test" } })).id;
});

afterEach(cleanup);

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/* The request -------------------------------------------------------------------- */

describe("the request (2026-11-09)", () => {
  it("takes one to 500 units, each once, and one change", () => {
    const units = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `unit_${index}`, version: 1 }));
    expect(() => bulk({ action: "archive", units: [] })).toThrow();
    expect(() => bulk({ action: "archive", units: units(501) })).toThrow();
    expect(() => bulk({ action: "archive", units: [{ id: "a", version: 1 }, { id: "a", version: 1 }] })).toThrow();
    expect(bulk({ action: "archive", units: units(500) }).units).toHaveLength(500);
    // Edit details needs at least one field, and only the fields it knows.
    expect(() => bulk({ action: "details", units: units(1), change: {} })).toThrow();
    expect(() => bulk({ action: "details", units: units(1), change: { unitCode: "X" } })).toThrow();
    expect(bulk({ action: "details", units: units(1), change: { bedrooms: 2, internalArea: "64.5", description: null } })).toMatchObject({ change: { bedrooms: 2, internalArea: "64.5", description: null } });
    // A price is a positive amount with at most two decimals.
    expect(() => bulk({ action: "price", units: units(1), entry: "TOTAL", amount: "0" })).toThrow();
    expect(() => bulk({ action: "price", units: units(1), entry: "TOTAL", amount: "12.345" })).toThrow();
    expect(bulk({ action: "price", units: units(1), entry: "PER_SQM", amount: "2000" })).toMatchObject({ amount: "2000", putOnSale: false });
  });
});

/* Edit details ---------------------------------------------------------------------- */

describe("edit details", () => {
  it("changes only the fields sent, works net and gross out again, and publishes each unit's next version", async () => {
    const a = await newUnit({ internalArea: null, bedrooms: null, description: "Corner" });
    const b = await newUnit({ internalArea: "70.00", bedrooms: 1 });
    const before = await prisma.unitPublication.count({ where: { unitId: { in: [a.id, b.id] } } });
    const outcome = await structure(pm, { action: "details", units: [{ id: a.id, version: a.version }, { id: b.id, version: b.version }], change: { internalArea: "64.72", commonAreaAllocation: "15.94", bedrooms: 2 } });
    expect(outcome.skipped).toEqual([]);
    expect(outcome.updated.map((unit) => [unit.id, unit.label, unit.version])).toEqual([
      [a.id, `${CODE}-${a.unitCode}`, a.version + 1],
      [b.id, `${CODE}-${b.unitCode}`, b.version + 1],
    ]);
    const rows = await prisma.projectUnit.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { sortOrder: "asc" }, select: { internalArea: true, netArea: true, grossArea: true, bedrooms: true, saleableArea: true, description: true, isActive: true } });
    for (const row of rows) {
      expect(row).toMatchObject({ bedrooms: 2, saleableArea: expect.anything(), isActive: true });
      expect(row.internalArea?.toFixed(2)).toBe("64.72");
      expect(row.netArea?.toFixed(2)).toBe("64.72");
      expect(row.grossArea?.toFixed(2)).toBe("80.66");
    }
    // What was not sent keeps each unit's own value.
    expect(rows[0]!.description).toBe("Corner");
    expect(await prisma.unitPublication.count({ where: { unitId: { in: [a.id, b.id] } } })).toBe(before + 2);
    expect(await prisma.activity.count({ where: { entityId: { in: [a.id, b.id] }, action: "UNIT_UPDATED" } })).toBe(2);
  });

  it("refuses a person without project.unit.update outright", async () => {
    const a = await newUnit();
    await refused(structure(sales, { action: "details", units: [{ id: a.id, version: a.version }], change: { bedrooms: 3 } }), "FORBIDDEN");
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: a.id }, select: { bedrooms: true } })).bedrooms).toBe(2);
  });

  it("skips a unit of another company or project as not found, and a unit changed since it was ticked", async () => {
    const a = await newUnit();
    const b = await newUnit();
    const foreign = await prisma.projectUnit.findFirstOrThrow({ where: { companyId: COMPANY.tenant }, select: { id: true, version: true } });
    const elsewhere = await prisma.projectUnit.findFirst({ where: { companyId: COMPANY_A, projectId: { not: RIVERSIDE } }, select: { id: true, version: true } });
    const units = [
      { id: a.id, version: a.version },
      { id: b.id, version: b.version + 7 },
      { id: foreign.id, version: foreign.version },
      ...(elsewhere ? [{ id: elsewhere.id, version: elsewhere.version }] : []),
    ];
    const outcome = await structure(pm, { action: "details", units, change: { bedrooms: 3 } });
    expect(outcome.updated.map((unit) => unit.id)).toEqual([a.id]);
    expect(outcome.skipped.map((skip) => [skip.id, skip.reason])).toEqual([[b.id, "changed"], [foreign.id, "not_found"], ...(elsewhere ? [[elsewhere.id, "not_found"]] : [])]);
    // Nothing about a unit that is not this project's is said: not even its code.
    expect(outcome.skipped.find((skip) => skip.id === foreign.id)?.label).toBeNull();
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: foreign.id }, select: { version: true } })).version).toBe(foreign.version);
  });

  it("keeps a unit active when its edit leaves isActive out (the dialog has no Active tick)", async () => {
    const a = await newUnit();
    await prisma.projectUnit.update({ where: { id: a.id }, data: { isActive: false } });
    const input = updateUnitSchema.parse({ unitCode: a.unitCode, unitTypeId: apartmentType, bedrooms: 3, expectedVersion: (await prisma.projectUnit.findUniqueOrThrow({ where: { id: a.id }, select: { version: true } })).version });
    await updateUnit(pm, a.id, input);
    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id: a.id }, select: { isActive: true, bedrooms: true } })).toEqual({ isActive: false, bedrooms: 3 });
  });
});

/* Set price ---------------------------------------------------------------------------- */

describe("set price", () => {
  it("prices per m² of each unit's sale area, skips a unit with no area and a sold one, and keeps the notes", async () => {
    const saleable = await newUnit({ saleableArea: "100.00", notes: "Sea view" });
    const gross = await newUnit({ saleableArea: null, grossArea: "80.66" });
    const bare = await newUnit({ saleableArea: null, grossArea: null });
    const sold = await newUnit({ status: "SOLD", price: "150000" });
    const refs = await Promise.all([saleable, gross, bare, sold].map(async (unit) => ({ id: unit.id, version: await salesVersion(unit.id) })));
    const outcome = await selling(sales, { action: "price", units: refs, entry: "PER_SQM", amount: "2000", reason: "Launch" });
    expect(outcome.updated.map((unit) => unit.id)).toEqual([saleable.id, gross.id]);
    expect(outcome.skipped.map((skip) => [skip.id, skip.reason])).toEqual([
      [bare.id, "no_area"],
      [sold.id, "sold"],
    ]);
    const profiles = await prisma.unitCommercialProfile.findMany({ where: { unitId: { in: [saleable.id, gross.id, sold.id] } }, select: { unitId: true, askingPrice: true, priceBasis: true, status: true, salesNotes: true } });
    const by = new Map(profiles.map((row) => [row.unitId, row]));
    expect(by.get(saleable.id)).toMatchObject({ priceBasis: "SALEABLE_AREA", status: "NOT_FOR_SALE", salesNotes: "Sea view" });
    expect(by.get(saleable.id)?.askingPrice?.toFixed(2)).toBe("200000.00");
    expect(by.get(gross.id)).toMatchObject({ priceBasis: "GROSS_AREA" });
    expect(by.get(gross.id)?.askingPrice?.toFixed(2)).toBe("161320.00");
    expect(by.get(sold.id)?.askingPrice?.toFixed(2)).toBe("150000.00");
    expect(await prisma.unitPriceHistory.count({ where: { unitId: { in: [saleable.id, gross.id] }, reason: "Launch" } })).toBe(2);
  });

  it("also puts the priced units not for sale on sale, and names the ones that stay back", async () => {
    const fresh = await newUnit();
    const offered = await newUnit({ status: "FOR_SALE", price: "100000" });
    const archived = await newUnit({ archived: true });
    const refs = await Promise.all([fresh, offered, archived].map(async (unit) => ({ id: unit.id, version: await salesVersion(unit.id) })));
    const outcome = await selling(sales, { action: "price", units: refs, entry: "TOTAL", amount: "250000", putOnSale: true });
    expect(outcome.updated.map((unit) => [unit.id, unit.status])).toEqual([
      [fresh.id, "FOR_SALE"],
      [offered.id, "FOR_SALE"],
      [archived.id, "NOT_FOR_SALE"],
    ]);
    expect(outcome.putOnSale).toEqual({ moved: [fresh.id], skipped: [expect.objectContaining({ id: archived.id, reason: "not_sellable" })] });
    // The price stayed on the archived unit; it is simply not offered.
    expect((await prisma.unitCommercialProfile.findFirstOrThrow({ where: { unitId: archived.id } })).askingPrice?.toFixed(2)).toBe("250000.00");
    expect(await prisma.unitCommercialStatusHistory.count({ where: { unitId: fresh.id, toStatus: "FOR_SALE" } })).toBe(1);
  });

  it("refuses a person without the price grant, and the sale-status grant when asked to put on sale", async () => {
    const unit = await newUnit();
    await refused(selling(pm, { action: "price", units: [{ id: unit.id, version: 0 }], entry: "TOTAL", amount: "100000" }), "FORBIDDEN");
    await refused(selling(architect, { action: "price", units: [{ id: unit.id, version: 0 }], entry: "TOTAL", amount: "100000" }), "FORBIDDEN");
    expect(await prisma.unitCommercialProfile.count({ where: { unitId: unit.id } })).toBe(0);
  });

  it("skips a unit whose sales record changed since it was ticked", async () => {
    const unit = await newUnit({ price: "90000" });
    const version = await salesVersion(unit.id);
    const outcome = await selling(sales, { action: "price", units: [{ id: unit.id, version: version + 1 }], entry: "TOTAL", amount: "100000" });
    expect(outcome.skipped).toEqual([expect.objectContaining({ id: unit.id, reason: "changed" })]);
  });
});

/* Sale status ------------------------------------------------------------------------- */

describe("put on sale and take off sale", () => {
  it("moves only the units the machine allows, and says why the others stayed", async () => {
    const fresh = await newUnit();
    const offered = await newUnit({ status: "FOR_SALE", price: "100000" });
    const reserved = await newUnit({ status: "RESERVED", price: "100000" });
    const archived = await newUnit({ archived: true });
    const refs = await Promise.all([fresh, offered, reserved, archived].map(async (unit) => ({ id: unit.id, version: await salesVersion(unit.id) })));
    const on = await selling(sales, { action: "status", units: refs, change: "put_on_sale" });
    expect(on.updated.map((unit) => unit.id)).toEqual([fresh.id]);
    expect(on.skipped.map((skip) => [skip.id, skip.reason])).toEqual([
      [offered.id, "already"],
      [reserved.id, "reserved"],
      [archived.id, "not_sellable"],
    ]);

    const off = await selling(sales, { action: "status", units: [{ id: fresh.id, version: on.updated[0]!.salesVersion }, { id: offered.id, version: await salesVersion(offered.id) }], change: "take_off_sale" });
    expect(off.updated.map((unit) => [unit.id, unit.status])).toEqual([
      [fresh.id, "NOT_FOR_SALE"],
      [offered.id, "NOT_FOR_SALE"],
    ]);
    await refused(selling(pm, { action: "status", units: [{ id: fresh.id, version: 0 }], change: "put_on_sale" }), "FORBIDDEN");
  });
});

/* Move and archive ---------------------------------------------------------------------- */

describe("move to floor and archive", () => {
  it("moves units to a floor of the project in the order ticked, and refuses a floor elsewhere", async () => {
    const a = await newUnit();
    const b = await newUnit();
    const there = await newUnit({ floor: otherFloorId });
    const outcome = await structure(pm, { action: "move", floorId: otherFloorId, units: [{ id: b.id, version: b.version }, { id: a.id, version: a.version }, { id: there.id, version: there.version }] });
    expect(outcome.updated.map((unit) => unit.id)).toEqual([b.id, a.id]);
    expect(outcome.skipped).toEqual([expect.objectContaining({ id: there.id, reason: "already" })]);
    const order = await prisma.projectUnit.findMany({ where: { floorId: otherFloorId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    expect(order.map((row) => row.id)).toEqual([there.id, b.id, a.id]);

    const foreignFloor = await prisma.projectFloor.findFirstOrThrow({ where: { companyId: COMPANY_A, projectId: { not: RIVERSIDE } }, select: { id: true } }).catch(() => null);
    if (foreignFloor) await refused(structure(pm, { action: "move", floorId: foreignFloor.id, units: [{ id: a.id, version: a.version + 1 }] }), "VALIDATION_ERROR");
  });

  it("archives units not on sale, skips the rest, and is refused without project.unit.archive", async () => {
    const a = await newUnit();
    const offered = await newUnit({ status: "FOR_SALE", price: "100000" });
    const gone = await newUnit({ archived: true });
    await refused(structure(pm, { action: "archive", units: [{ id: a.id, version: a.version }] }), "FORBIDDEN");
    const outcome = await structure(owner, { action: "archive", units: [{ id: a.id, version: a.version }, { id: offered.id, version: offered.version }, { id: gone.id, version: gone.version }] });
    expect(outcome.updated.map((unit) => unit.id)).toEqual([a.id]);
    expect(outcome.skipped.map((skip) => [skip.id, skip.reason])).toEqual([
      [offered.id, "on_sale"],
      [gone.id, "already"],
    ]);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: a.id }, select: { publicationStatus: true } })).publicationStatus).toBe("ARCHIVED");
  });
});

/* Selections and what is missing ------------------------------------------------------------ */

describe("selections and missing data", () => {
  it("counts what units in use miss, and ticks exactly those", async () => {
    const complete = await newUnit({ price: "100000" });
    const noArea = await newUnit({ saleableArea: null, grossArea: null, price: "100000" });
    const noBeds = await newUnit({ bedrooms: null, price: "100000" });
    const noPrice = await newUnit();
    // A parking space needs no area, and an archived unit misses nothing.
    const parking = await newUnit({ type: parkingType, saleableArea: null, bedrooms: null, internalArea: null, price: "15000" });
    await newUnit({ archived: true, saleableArea: null });

    const list = await listProjectUnits(pm, RIVERSIDE, { floorId, page: 1, limit: 50 });
    expect(list.missing).toEqual({ details: 2, price: 1, either: 3 });
    expect(list.items.find((item) => item.id === complete.id)?.salesVersion).toBeGreaterThan(0);

    const ids = async (missing: "area" | "details" | "price" | "either") => (await listProjectUnitSelection(pm, RIVERSIDE, { floorId, missing })).units.map((unit) => unit.id).sort();
    expect(await ids("area")).toEqual([noArea.id].sort());
    expect(await ids("details")).toEqual([noArea.id, noBeds.id].sort());
    expect(await ids("price")).toEqual([noPrice.id].sort());
    expect(await ids("either")).toEqual([noArea.id, noBeds.id, noPrice.id].sort());
    expect((await listProjectUnitSelection(pm, RIVERSIDE, { floorId })).total).toBe(6);
    expect((await listProjectUnitSelection(pm, RIVERSIDE, { floorId, q: `${CODE}${parking.unitCode}` })).units.map((unit) => unit.label)).toEqual([`${CODE}-${parking.unitCode}`]);
  });

  it("ticks every unit the Sales filters match, not one page", async () => {
    const offered = await newUnit({ status: "FOR_SALE", price: "100000" });
    await newUnit();
    const selection = await listSalesSelection(sales, RIVERSIDE, parseInventoryQuery({ floorId, commercialStatus: "FOR_SALE" }));
    expect(selection).toMatchObject({ total: 1, limit: 500, units: [expect.objectContaining({ id: offered.id, status: "FOR_SALE", priced: true, label: `${CODE}-${offered.unitCode}` })] });
    await refused(listSalesSelection(architect, RIVERSIDE, parseInventoryQuery({ floorId })), "FORBIDDEN");
  });
});
