import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { priceListSaveSchema } from "@/lib/modules/sales/units/unit-pricing.schema";
import { getPriceList, savePriceList } from "@/lib/modules/sales/units/unit-pricing.service";
import type { PriceListDTO } from "@/lib/modules/sales/units/unit-pricing.types";
import { getUnitSales } from "@/lib/modules/sales/units/unit-sales.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * A project's price list against the real database (2026-11): a floor priced at
 * a rate per m², every parking space at one price, single units by hand — each
 * change with the history, activity and audit a one-unit change leaves, and the
 * whole save refused when one unit is stale, sold or not the project's — and,
 * with "Also put them on sale", the units it priced that were not for sale
 * moved on sale one by one, with the ones that could not named.
 *
 * A building this suite adds to Riverside Residences (project_a); everything it
 * makes is removed.
 */

const COMPANY_A = "company_demo_a";
const RIVERSIDE = PROJECT.a;
const T = "PRICES";

let owner: UserContext;
let sales: UserContext;
let finance: UserContext;
let ownerB: UserContext;
let apartmentType: string;
let parkingType: string;
let floorId: string;
let basementId: string;
let serial = 0;

async function cleanup() {
  const buildings = await prisma.projectBuilding.findMany({ where: { projectId: RIVERSIDE, nameKey: { startsWith: T } }, select: { id: true } });
  const floors = await prisma.projectFloor.findMany({ where: { buildingId: { in: buildings.map((row) => row.id) } }, select: { id: true } });
  const units = await prisma.projectUnit.findMany({ where: { floorId: { in: floors.map((row) => row.id) } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  await prisma.unitPriceHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: unitIds } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: unitIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: unitIds } } });
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

async function newUnit(options: { floor?: string; type?: string; saleableArea?: string | null } = {}) {
  serial += 1;
  const code = `${T}-${String(serial).padStart(3, "0")}`;
  return prisma.projectUnit.create({
    data: {
      companyId: COMPANY_A,
      projectId: RIVERSIDE,
      floorId: options.floor ?? floorId,
      unitCode: code,
      unitCodeKey: code,
      unitTypeId: options.type ?? apartmentType,
      saleableArea: options.saleableArea === undefined ? "100.00" : options.saleableArea,
      sortOrder: serial,
      createdBy: "test",
      publicationStatus: "PUBLISHED",
    },
    select: { id: true, unitCode: true },
  });
}

/** The suite's own building in a price list. */
function ours(list: PriceListDTO) {
  return list.buildings.find((building) => building.name.startsWith(T))!;
}

const save = (context: UserContext, input: Record<string, unknown>) => savePriceList(context, RIVERSIDE, priceListSaveSchema.parse({ currency: "EUR", ...input }));

beforeAll(async () => {
  [owner, sales, finance] = await Promise.all((["OWNER", "SALES", "FINANCE"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsMembership("member_owner_b");
  apartmentType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "APARTMENT" }, select: { id: true } })).id;
  parkingType = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY_A, code: "PARKING" }, select: { id: true } })).id;
  await cleanup();
});

beforeEach(async () => {
  const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, name: `${T} Block`, nameKey: `${T} BLOCK`, sortOrder: 95, createdBy: "test" } });
  basementId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, buildingId: building.id, levelType: "BASEMENT", number: -1, name: "Basement 1", floorKey: "BASEMENT:-1", sortOrder: 1, createdBy: "test" } })).id;
  floorId = (await prisma.projectFloor.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, buildingId: building.id, levelType: "STANDARD", number: 3, name: "Floor 3", floorKey: "STANDARD:3", sortOrder: 2, createdBy: "test" } })).id;
});

afterEach(cleanup);

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("reading the price list", () => {
  it("lays out the active units by building and floor, with their category, price and version", async () => {
    const a = await newUnit({ saleableArea: "85.37" });
    const p = await newUnit({ floor: basementId, type: parkingType, saleableArea: null });
    const archived = await newUnit();
    await prisma.projectUnit.update({ where: { id: archived.id }, data: { isActive: false } });

    const list = await getPriceList(sales, RIVERSIDE);
    expect(list.canManagePrice).toBe(true);
    const building = ours(list);
    expect(building.floors.map((floor) => floor.name)).toEqual(["Basement 1", "Floor 3"]);
    expect(building.floors[0]!.units).toEqual([expect.objectContaining({ id: p.id, category: "PARKING", saleableArea: null, askingPrice: null, status: "NOT_FOR_SALE", version: 0 })]);
    expect(building.floors[1]!.units.map((unit) => unit.id)).toEqual([a.id]);
    expect(building.floors[1]!.units[0]).toMatchObject({ category: "RESIDENTIAL", saleableArea: "85.37" });

    expect((await getPriceList(finance, RIVERSIDE)).canManagePrice).toBe(false);
  });

  it("is the reader's own company's project only", async () => {
    await refused(getPriceList(ownerB, RIVERSIDE), "NOT_FOUND");
  });
});

describe("saving prices", () => {
  it("prices a floor per m² and the parking per space in one save, each with its history, activity and audit", async () => {
    const a = await newUnit({ saleableArea: "85.37" });
    const b = await newUnit({ saleableArea: "100.00" });
    const p1 = await newUnit({ floor: basementId, type: parkingType, saleableArea: null });
    const p2 = await newUnit({ floor: basementId, type: parkingType, saleableArea: null });

    const result = await save(sales, {
      reason: "2027 price list",
      prices: [
        { unitId: a.id, askingPrice: "102444.00", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
        { unitId: b.id, askingPrice: "135000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }, // by hand
        { unitId: p1.id, askingPrice: "15000", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 },
        { unitId: p2.id, askingPrice: "15000", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 },
      ],
    });
    expect(result.saved).toBe(4);
    const floor = ours(result.list).floors[1]!;
    expect(floor.units.map((unit) => [unit.askingPrice, unit.currency, unit.priceBasis, unit.version])).toEqual([
      ["102444.00", "EUR", "SALEABLE_AREA", 2],
      ["135000.00", "EUR", "SALEABLE_AREA", 2],
    ]);

    const view = await getUnitSales(sales, a.id);
    expect(view).toMatchObject({ status: "NOT_FOR_SALE", askingPrice: "102444.00", pricePerSqm: "1200.00" });
    expect(view.priceHistory.map((row) => [row.oldPrice, row.newPrice, row.reason])).toEqual([[null, "102444.00", "2027 price list"]]);
    expect((await getUnitSales(sales, p1.id))).toMatchObject({ askingPrice: "15000.00", priceBasis: "FIXED_UNIT_PRICE", pricePerSqm: null });

    const ids = [a.id, b.id, p1.id, p2.id];
    expect(await prisma.unitPriceHistory.count({ where: { unitId: { in: ids } } })).toBe(4);
    expect(await prisma.activity.count({ where: { entityId: { in: ids }, action: "UNIT_PRICE_CHANGED" } })).toBe(4);
    expect(await prisma.auditEvent.count({ where: { entityId: { in: ids }, actionKey: "UNIT_PRICE_CHANGED" } })).toBe(4);
    // Status never moves here: priced is not on sale.
    expect(await prisma.unitCommercialProfile.count({ where: { unitId: { in: ids }, status: "NOT_FOR_SALE" } })).toBe(4);
  });

  it("records nothing for a price that did not change, and clears a price when asked", async () => {
    const a = await newUnit();
    await save(sales, { prices: [{ unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    expect((await save(sales, { prices: [{ unitId: a.id, askingPrice: "120000.00", priceBasis: "SALEABLE_AREA", expectedVersion: 2 }] })).saved).toBe(0);
    expect(await prisma.unitPriceHistory.count({ where: { unitId: a.id } })).toBe(1);

    const cleared = await save(sales, { prices: [{ unitId: a.id, askingPrice: "", priceBasis: "SALEABLE_AREA", expectedVersion: 2 }] });
    expect(cleared.saved).toBe(1);
    expect(ours(cleared.list).floors[1]!.units[0]).toMatchObject({ askingPrice: null, currency: "EUR" });
  });

  it("refuses the whole save when one unit changed since it was read, writing nothing", async () => {
    const a = await newUnit();
    const b = await newUnit();
    await save(owner, { prices: [{ unitId: b.id, askingPrice: "99000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });

    await refused(
      save(sales, {
        prices: [
          { unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
          { unitId: b.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }, // read before the owner's change
        ],
      }),
      "CONFLICT",
      "UNIT_SALES_STALE",
    );
    expect(await prisma.unitPriceHistory.count({ where: { unitId: { in: [a.id, b.id] } } })).toBe(1);
    expect((await getUnitSales(sales, a.id)).askingPrice).toBeNull();
    expect((await getUnitSales(sales, b.id)).askingPrice).toBe("99000.00");
  });

  it("never changes a sold unit's price", async () => {
    const a = await newUnit();
    const sold = await newUnit();
    await save(sales, { prices: [{ unitId: sold.id, askingPrice: "150000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    await prisma.unitCommercialProfile.update({ where: { unitId: sold.id }, data: { status: "SOLD" } });

    const error = await refused(
      save(sales, {
        prices: [
          { unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
          { unitId: sold.id, askingPrice: "160000", priceBasis: "SALEABLE_AREA", expectedVersion: 2 },
        ],
      }),
      "CONFLICT",
      "UNIT_SOLD",
    );
    expect(error.details).toMatchObject({ unitCode: sold.unitCode });
    expect((await getUnitSales(sales, a.id)).askingPrice).toBeNull();
    expect((await getUnitSales(sales, sold.id)).askingPrice).toBe("150000.00");
  });

  it("prices only the project's own active units", async () => {
    const a = await newUnit();
    const elsewhere = await prisma.projectUnit.findFirstOrThrow({ where: { companyId: COMPANY_A, projectId: { not: RIVERSIDE } }, select: { id: true } }).catch(() => null);
    const archived = await newUnit();
    await prisma.projectUnit.update({ where: { id: archived.id }, data: { isActive: false } });

    for (const unitId of [archived.id, ...(elsewhere ? [elsewhere.id] : [])]) {
      await refused(
        save(sales, {
          prices: [
            { unitId: a.id, askingPrice: "1", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 },
            { unitId, askingPrice: "1", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 },
          ],
        }),
        "NOT_FOUND",
        "PRICE_LIST_UNIT_NOT_FOUND",
      );
    }
    expect(await prisma.unitCommercialProfile.count({ where: { unitId: a.id } })).toBe(0);
  });

  it("is for those who may set asking prices, in their own company", async () => {
    const a = await newUnit();
    const input = { prices: [{ unitId: a.id, askingPrice: "1", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 }] };
    await refused(save(finance, input), "FORBIDDEN");
    await refused(save(ownerB, input), "NOT_FOUND");
    expect(await prisma.unitCommercialProfile.count({ where: { unitId: a.id } })).toBe(0);
  });
});

describe("also putting the priced units on sale (2026-11-09)", () => {
  const status = async (unitId: string) => (await prisma.unitCommercialProfile.findFirst({ where: { unitId }, select: { status: true } }))?.status ?? null;
  /** The SALES role without the sale-status grant: it may price, not offer. */
  const priceOnly = () => ({ ...sales, permissions: sales.permissions.filter((permission) => permission !== "project.unit.sales_status.manage") });

  it("puts the units it priced that were not for sale on sale, and names the ones that cannot go", async () => {
    const fresh = await newUnit();
    const offered = await newUnit();
    const archived = await newUnit();
    await save(sales, { prices: [{ unitId: offered.id, askingPrice: "90000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    await prisma.unitCommercialProfile.update({ where: { unitId: offered.id }, data: { status: "FOR_SALE" } });
    await prisma.projectUnit.update({ where: { id: archived.id }, data: { publicationStatus: "ARCHIVED" } });

    expect((await getPriceList(sales, RIVERSIDE)).canManageStatus).toBe(true);
    const result = await save(sales, {
      putOnSale: true,
      prices: [
        { unitId: fresh.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
        { unitId: offered.id, askingPrice: "95000", priceBasis: "SALEABLE_AREA", expectedVersion: 2 },
        { unitId: archived.id, askingPrice: "130000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
      ],
    });
    expect(result.saved).toBe(3);
    expect(result.putOnSale).toEqual({ moved: [fresh.id], skipped: [expect.objectContaining({ id: archived.id, label: archived.unitCode, reason: "not_sellable" })] });
    expect([await status(fresh.id), await status(offered.id), await status(archived.id)]).toEqual(["FOR_SALE", "FOR_SALE", "NOT_FOR_SALE"]);
    // The archived unit keeps the price it was given; it is simply not offered.
    expect((await getUnitSales(sales, archived.id)).askingPrice).toBe("130000.00");
    // The list answered is read after the move.
    expect(ours(result.list).floors[1]!.units.find((unit) => unit.id === fresh.id)).toMatchObject({ status: "FOR_SALE", version: 3 });
    expect(await prisma.unitCommercialStatusHistory.count({ where: { unitId: fresh.id, toStatus: "FOR_SALE" } })).toBe(1);
  });

  it("leaves the status alone without the tick, and for a price cleared", async () => {
    const a = await newUnit();
    const b = await newUnit();
    await save(sales, { prices: [{ unitId: b.id, askingPrice: "90000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    const without = await save(sales, { prices: [{ unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    expect(without.putOnSale).toBeUndefined();
    const cleared = await save(sales, { putOnSale: true, prices: [{ unitId: b.id, askingPrice: "", priceBasis: "SALEABLE_AREA", expectedVersion: 2 }] });
    expect(cleared.putOnSale).toEqual({ moved: [], skipped: [] });
    expect([await status(a.id), await status(b.id)]).toEqual(["NOT_FOR_SALE", "NOT_FOR_SALE"]);
  });

  it("refuses the tick to somebody who may price but not offer, before saving anything", async () => {
    const a = await newUnit();
    const input = { putOnSale: true, prices: [{ unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] };
    await refused(save(priceOnly(), input), "FORBIDDEN");
    expect(await prisma.unitCommercialProfile.count({ where: { unitId: a.id } })).toBe(0);
    expect((await getPriceList(priceOnly(), RIVERSIDE)).canManageStatus).toBe(false);
    // Without the tick the same person prices as before.
    expect((await save(priceOnly(), { ...input, putOnSale: false })).saved).toBe(1);
  });

  it("moves nothing when the save is refused: a stale unit, or another company's", async () => {
    const a = await newUnit();
    const b = await newUnit();
    await save(owner, { prices: [{ unitId: b.id, askingPrice: "99000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 }] });
    await refused(
      save(sales, {
        putOnSale: true,
        prices: [
          { unitId: a.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
          { unitId: b.id, askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 },
        ],
      }),
      "CONFLICT",
      "UNIT_SALES_STALE",
    );
    await refused(save(ownerB, { putOnSale: true, prices: [{ unitId: a.id, askingPrice: "1", priceBasis: "FIXED_UNIT_PRICE", expectedVersion: 0 }] }), "NOT_FOUND");
    expect([await status(a.id), await status(b.id)]).toEqual([null, "NOT_FOR_SALE"]);
    expect(await prisma.unitCommercialStatusHistory.count({ where: { unitId: { in: [a.id, b.id] } } })).toBe(0);
  });
});
