import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { balanceListQuerySchema, itemListQuerySchema, transactionListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import * as items from "@/lib/modules/inventory/items/item.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * AUD-08 on the inventory item list (DT-03, DT-04, DT-05): the low-stock view
 * and the stock sort are derived from summed balances, and the view used to
 * rank only the first 500 items by name — a low item beyond them was missing,
 * and the count agreed with the omission.
 *
 * 503 items all with a reorder point of 10: items 000–499 hold 100 (in stock),
 * item 500 holds nothing (out of stock), items 501 and 502 hold 5 (low). The
 * three low ones sort after the first 500 by name.
 */

const PREFIX = "aud08c2_itm";
const SEARCH = "AUD08C2-ITM";
const MEMBER = "member_inventory";
const LOCATION = { warehouseId: "wh_central", locationId: "loc_central_main" };
const id = (n: number) => `${PREFIX}_${String(n).padStart(3, "0")}`;

async function removeFixtures() {
  await prisma.inventoryBalance.deleteMany({ where: { inventoryItemId: { startsWith: PREFIX } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  await prisma.inventoryItem.createMany({
    data: Array.from({ length: 503 }, (_, n) => ({
      id: id(n),
      companyId: COMPANY.a,
      // Leading zeros keep the codes in number order as text.
      sku: `${SEARCH}-${String(n).padStart(3, "0")}`,
      name: `${SEARCH} ${String(n).padStart(3, "0")}`,
      category: "MATERIAL" as const,
      baseUnit: "pcs",
      reorderPoint: new Prisma.Decimal("10"),
      createdByMemberId: MEMBER,
    })),
  });
  const held = (n: number, quantity: string) => ({
    companyId: COMPANY.a,
    inventoryItemId: id(n),
    ...LOCATION,
    onHandQuantity: new Prisma.Decimal(quantity),
    availableQuantity: new Prisma.Decimal(quantity),
  });
  await prisma.inventoryBalance.createMany({
    data: [...Array.from({ length: 500 }, (_, n) => held(n, "100")), held(501, "5"), held(502, "5")],
  });
});

afterAll(async () => {
  await removeFixtures();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("the low-stock view and the stock sort (AUD-08 §3, §4)", () => {
  it("DT-03: every low item is found and counted, not only those among the first 500 by name", async () => {
    const inventory = await loginAs("INVENTORY");
    const result = await items.listItems(inventory, itemListQuerySchema.parse({ view: "low-stock", sort: "stock-asc", search: SEARCH }));
    expect(result.pagination.total).toBe(3);
    // Out of stock first, then the two equal lows by name (then id).
    expect(result.data.map((row) => row.id)).toEqual([id(500), id(501), id(502)]);
    expect(result.data.map((row) => row.level)).toEqual(["OUT_OF_STOCK", "LOW", "LOW"]);
  });

  it("DT-04: the stock sort orders the whole list by the summed Decimal, paging stays stable", async () => {
    const inventory = await loginAs("INVENTORY");
    const read = (page: number) => items.listItems(inventory, itemListQuerySchema.parse({ view: "all", sort: "stock-asc", search: SEARCH, limit: 2, page }));
    const first = await read(1);
    const second = await read(2);
    expect(first.pagination.total).toBe(503);
    expect([...first.data, ...second.data].map((row) => row.id)).toEqual([id(500), id(501), id(502), id(0)]);
  });

  it("DT-05: a page past the end of the derived view reads its last page", async () => {
    const inventory = await loginAs("INVENTORY");
    const past = await items.listItems(inventory, itemListQuerySchema.parse({ view: "low-stock", sort: "stock-asc", search: SEARCH, limit: 2, page: 9 }));
    expect(past.pagination).toMatchObject({ page: 2, totalPages: 2, total: 3 });
    expect(past.data.map((row) => row.id)).toEqual([id(502)]);
  });

  it("the plain list pages by name with the id tie-breaker, counted before pagination", async () => {
    const inventory = await loginAs("INVENTORY");
    const last = await items.listItems(inventory, itemListQuerySchema.parse({ view: "all", search: SEARCH, limit: 100, page: 6 }));
    expect(last.pagination).toMatchObject({ page: 6, total: 503, totalPages: 6 });
    expect(last.data.map((row) => row.id)).toEqual([id(500), id(501), id(502)]);
  });
});

describe("list query parsing (AUD-08 §3)", () => {
  it("`heldOnly=false` means false; a stale sort falls back to the default instead of failing", () => {
    expect(balanceListQuerySchema.parse({ heldOnly: "false" }).heldOnly).toBe(false);
    expect(balanceListQuerySchema.parse({ heldOnly: "0" }).heldOnly).toBe(false);
    expect(balanceListQuerySchema.parse({}).heldOnly).toBe(true);
    expect(transactionListQuerySchema.parse({ sort: "no-such-sort" }).sort).toBe("date-desc");
    expect(itemListQuerySchema.parse({ view: "nope" }).view).toBe("all");
  });
});
