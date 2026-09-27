import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { lowStockRows } from "@/lib/modules/dashboard/dashboard.service";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * The dashboard's low-stock list and count (AUD-08 §4, DT-03, DT-04).
 *
 * The count is every item at or below its reorder point, not the count among
 * an arbitrary first 300 items read without an order (the old `take: 300`).
 * Ties on on-hand quantity order by SKU, then id.
 *
 * Fixture, in the fixture company: 320 active items with reorder point 10 and
 * no stock (all low), SKUs with leading zeros; one whose on-hand (0) is above
 * its reorder point (-1: not low, the positive control); one archived and low
 * (never counted). Ids are written out here and removed in afterAll.
 */

const OWNER = "member_fixture_owner";
const COMPANY = "company_fixture";
const PREFIX = "aud08m_item_";
const LOW_COUNT = 320;

let owner: UserContext;
const expectedLow = Array.from({ length: LOW_COUNT }, (_, index) => `${PREFIX}low_${String(index).padStart(4, "0")}`);

function item(id: string, sku: string, extra: Record<string, unknown> = {}) {
  return { id, companyId: COMPANY, sku, name: `aud08m ${sku}`, category: "MATERIAL" as const, baseUnit: "pcs", reorderPoint: 10, createdByMemberId: OWNER, ...extra };
}

beforeAll(async () => {
  owner = await loginAsMembership(OWNER);
  // SKU order is the reverse of id order, so the expected order below is by SKU and not by id.
  await prisma.inventoryItem.createMany({
    data: [
      ...expectedLow.map((id, index) => item(id, `AUD08M-${String(LOW_COUNT - index).padStart(5, "0")}`)),
      item(`${PREFIX}archived`, "AUD08M-ARCHIVED", { archivedAt: new Date("2026-01-01T00:00:00Z"), archivedByMemberId: OWNER }),
      // On hand 0 is above a reorder point of -1: not low.
      item(`${PREFIX}stocked`, "AUD08M-STOCKED", { reorderPoint: -1 }),
    ],
  });
});

afterAll(async () => {
  await prisma.inventoryItem.deleteMany({ where: { companyId: COMPANY, id: { startsWith: PREFIX } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("low stock counts every matching item (AUD-08 §4)", () => {
  it("includes all 320 low fixtures beyond the old 300-item read, and nothing it should not", async () => {
    const rows = await lowStockRows(owner);
    const mine = rows.filter((row) => row.id.startsWith(PREFIX)).map((row) => row.id);
    // Every one of them is low: none was dropped by a read limit (DT-03).
    expect(new Set(mine)).toEqual(new Set(expectedLow));
    expect(mine).toHaveLength(LOW_COUNT);
    // Archived items never count, and an item above its reorder point is not low (positive control for the comparison).
    expect(mine).not.toContain(`${PREFIX}archived`);
    expect(mine).not.toContain(`${PREFIX}stocked`);
  });

  it("ties on on-hand order by SKU (leading zeros kept as text), then id (DT-04)", async () => {
    const rows = await lowStockRows(owner);
    const mine = rows.filter((row) => row.id.startsWith(`${PREFIX}low_`)).map((row) => row.id);
    // SKU AUD08M-00001 belongs to the last id, AUD08M-00320 to the first.
    expect(mine).toEqual([...expectedLow].reverse());
    const again = await lowStockRows(owner);
    expect(again.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });
});
