import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/lib/actions/inventory";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * AUD-09 — Inventory forms (FV-05, FV-06, FV-07, FV-08, FV-09, FV-16). The
 * real actions as the seeded Inventory account; persisted state asserted;
 * refusals paired with positive controls.
 */

const PREFIX = "aud09c_";
const made = { items: new Set<string>(), transfers: new Set<string>(), issues: new Set<string>() };

afterEach(async () => {
  const all = [...made.items, ...made.transfers, ...made.issues];
  if (all.length > 0) await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  if (made.transfers.size > 0) {
    await prisma.stockTransferLine.deleteMany({ where: { stockTransferId: { in: [...made.transfers] } } });
    await prisma.stockTransfer.deleteMany({ where: { id: { in: [...made.transfers] } } });
  }
  if (made.issues.size > 0) {
    await prisma.stockIssueLine.deleteMany({ where: { stockIssueId: { in: [...made.issues] } } });
    await prisma.stockIssue.deleteMany({ where: { id: { in: [...made.issues] } } });
  }
  if (made.items.size > 0) await prisma.inventoryItem.deleteMany({ where: { id: { in: [...made.items] } } });
  for (const set of Object.values(made)) set.clear();
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

async function asInventory<T>(run: () => Promise<T>): Promise<T> {
  actAs(await loginAs("INVENTORY"));
  try {
    return await run();
  } finally {
    actAs(null);
  }
}

function idFrom(result: { ok: boolean; redirectTo?: string; error?: string }): string {
  expect(result).toMatchObject({ ok: true });
  return result.redirectTo!.split("/").pop()!;
}

describe("FV-09 / FV-05 — an item's defaults and status", () => {
  const itemForm = (extra: Record<string, string>) =>
    form({ sku: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`, name: `${PREFIX}Item`, category: "MATERIAL", baseUnit: "bag", minimumStock: "", reorderPoint: "", ...extra });

  it("refuses another company's warehouse and a location of another warehouse; its own pair passes", async () => {
    const foreign = await asInventory(() => actions.createItemAction(itemForm({ defaultWarehouseId: "wh_b_central" })));
    expect(foreign.ok ? null : Object.keys(foreign.fieldErrors ?? {})).toEqual(["defaultWarehouseId"]);
    const mismatch = await asInventory(() => actions.createItemAction(itemForm({ defaultWarehouseId: "wh_central", defaultLocationId: "loc_riverside_main" })));
    expect(mismatch.ok ? null : Object.keys(mismatch.fieldErrors ?? {})).toEqual(["defaultLocationId"]);
    expect(await prisma.inventoryItem.count({ where: { name: `${PREFIX}Item` } })).toBe(0);

    const ok = await asInventory(() => actions.createItemAction(itemForm({ defaultWarehouseId: "wh_central", defaultLocationId: "loc_central_rack", status: "INACTIVE", minimumStock: "10", reorderPoint: "12,5" })));
    const id = idFrom(ok);
    made.items.add(id);
    const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { defaultWarehouseId: true, defaultLocationId: true, status: true, minimumStock: true, reorderPoint: true } });
    expect(row).toMatchObject({ defaultWarehouseId: "wh_central", defaultLocationId: "loc_central_rack", status: "INACTIVE" });
    expect([row.minimumStock?.toFixed(4), row.reorderPoint?.toFixed(4)]).toEqual(["10.0000", "12.5000"]);

    // An edit that leaves status out keeps the item inactive; empty levels clear.
    const sku = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { sku: true } })).sku;
    const edited = await asInventory(() => actions.updateItemAction(id, form({ sku, name: `${PREFIX}Item`, category: "MATERIAL", baseUnit: "bag", minimumStock: "", reorderPoint: "" })));
    expect(edited.ok).toBe(true);
    const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true, minimumStock: true, reorderPoint: true } });
    expect(after).toEqual({ status: "INACTIVE", minimumStock: null, reorderPoint: null });
  });

  it("refuses the thousands comma that used to book 1,000 as 1", async () => {
    const result = await asInventory(() => actions.createItemAction(itemForm({ minimumStock: "1,000" })));
    expect(result.ok ? null : result.fieldErrors?.minimumStock?.[0]).toContain("ambiguous");
  });
});

describe("FV-16 — line errors keep their row", () => {
  it("names the submitted row of a same-location transfer line, after a blank row", async () => {
    const result = await asInventory(() =>
      actions.createDocumentAction(
        "transfers",
        form({
          fromWarehouseId: "wh_central",
          toWarehouseId: "wh_central",
          transferDate: "2026-03-01",
          "lines.0.inventoryItemId": "item_cement",
          "lines.0.fromLocationId": "loc_central_main",
          "lines.0.toLocationId": "loc_central_rack",
          "lines.0.quantity": "1",
          // A row added and left without an item: dropped, but keeps its place.
          "lines.1.inventoryItemId": "",
          "lines.2.inventoryItemId": "item_cement",
          "lines.2.fromLocationId": "loc_central_main",
          "lines.2.toLocationId": "loc_central_main",
          "lines.2.quantity": "0",
        }),
      ),
    );
    expect(result.ok ? null : Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["lines.2.quantity", "lines.2.toLocationId"]);
    expect(await prisma.stockTransfer.count({ where: { notes: `${PREFIX}transfer` } })).toBe(0);

    const ok = await asInventory(() =>
      actions.createDocumentAction(
        "transfers",
        form({
          fromWarehouseId: "wh_central",
          toWarehouseId: "wh_central",
          transferDate: "2026-03-01",
          notes: `${PREFIX}transfer`,
          "lines.0.inventoryItemId": "item_cement",
          "lines.0.fromLocationId": "loc_central_main",
          "lines.0.toLocationId": "loc_central_rack",
          "lines.0.quantity": "2,5",
        }),
      ),
    );
    const id = idFrom(ok);
    made.transfers.add(id);
    const lines = await prisma.stockTransferLine.findMany({ where: { stockTransferId: id }, select: { quantity: true } });
    expect(lines.map((line) => line.quantity.toFixed(4))).toEqual(["2.5000"]);
  });

  it("an adjustment may be negative but not zero", async () => {
    const zero = await asInventory(() =>
      actions.createDocumentAction(
        "adjustments",
        form({ warehouseId: "wh_central", adjustmentDate: "2026-03-01", reason: "PHYSICAL_COUNT", "lines.0.inventoryItemId": "item_cement", "lines.0.locationId": "loc_central_main", "lines.0.quantityDelta": "-0" }),
      ),
    );
    expect(zero.ok ? null : Object.keys(zero.fieldErrors ?? {})).toEqual(["lines.0.quantityDelta"]);
  });
});

describe("FV-09 — people on a stock document", () => {
  it("refuses another company's member as 'issued to'; this company's active member passes", async () => {
    const base = { warehouseId: "wh_central", projectId: PROJECT.a, issueDate: "2026-03-01", notes: `${PREFIX}issue`, "lines.0.inventoryItemId": "item_cement", "lines.0.locationId": "loc_central_main", "lines.0.quantity": "1" };
    const forged = await asInventory(() => actions.createDocumentAction("issues", form({ ...base, issuedToMemberId: "member_fixture_owner" })));
    expect(forged.ok ? null : Object.keys(forged.fieldErrors ?? {})).toEqual(["issuedToMemberId"]);
    expect(await prisma.stockIssue.count({ where: { notes: `${PREFIX}issue` } })).toBe(0);

    const ok = await asInventory(() => actions.createDocumentAction("issues", form({ ...base, issuedToMemberId: "member_owner" })));
    const id = idFrom(ok);
    made.issues.add(id);
    expect((await prisma.stockIssue.findUniqueOrThrow({ where: { id }, select: { issuedToMemberId: true } })).issuedToMemberId).toBe("member_owner");
  });
});

describe("FV-07 — reservation dates in order", () => {
  it("refuses an expiry before the date needed, on the expiry field", async () => {
    const result = await asInventory(() =>
      actions.createReservationAction(
        form({ inventoryItemId: "item_cement", warehouseId: "wh_central", locationId: "loc_central_main", quantity: "1", requiredDate: "2026-03-10", expiresAt: "2026-03-09" }),
      ),
    );
    expect(result.ok ? null : Object.keys(result.fieldErrors ?? {})).toEqual(["expiresAt"]);
  });
});
