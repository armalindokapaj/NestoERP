import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import * as balances from "@/lib/modules/inventory/balances/balance.service";
import * as adjustments from "@/lib/modules/inventory/documents/adjustment.service";
import * as issues from "@/lib/modules/inventory/documents/issue.service";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import * as returns from "@/lib/modules/inventory/documents/return.service";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import * as items from "@/lib/modules/inventory/items/item.service";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import * as reservations from "@/lib/modules/inventory/reservations/reservation.service";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
import { exportInventory } from "@/lib/modules/inventory/inventory.export";
import { inventoryOverview } from "@/lib/modules/inventory/overview/overview.service";
import {
  inventoryReports,
  projectConsumption,
} from "@/lib/modules/inventory/reports/reports.service";
import {
  adjustmentSchema,
  balanceListQuerySchema,
  issueSchema,
  itemListQuerySchema,
  itemSchema,
  movementListQuerySchema,
  receiptSchema,
  reservationListQuerySchema,
  reservationSchema,
  returnSchema,
  transactionListQuerySchema,
  transferSchema,
  warehouseListQuerySchema,
  warehouseSchema,
} from "@/lib/modules/inventory/inventory.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Inventory authorisation and stock-integrity tests (PRD #20 §354–§383).
 *
 * These call the same services the pages call, so a passing test is a statement
 * about the running product rather than about a mock (PRD #9 §223).
 *
 * The rules this module exists to hold:
 *   1. the ledger is the truth and balances are a projection of it,
 *   2. stock never goes negative, and available never goes negative,
 *   3. only a posted document moves stock, and a posted one is never edited,
 *   4. a reservation holds quantity back without moving anything,
 *   5. no code outside the balance service may write a balance,
 *   6. Company B is unreachable by every route in and out.
 */

const itemQuery = itemListQuerySchema.parse({ limit: 200 });
const warehouseQuery = warehouseListQuerySchema.parse({ limit: 100 });
const transactionQuery = transactionListQuerySchema.parse({ limit: 100 });
const reservationQuery = reservationListQuerySchema.parse({ limit: 100 });
const movementQuery = movementListQuerySchema.parse({ limit: 500 });
const balanceQuery = balanceListQuerySchema.parse({ limit: 500 });

const SEED = {
  item: "item_cement",
  rebar: "item_rebar16",
  paper: "item_paper",
  centralWarehouse: "wh_central",
  centralLocation: "loc_central_main",
  centralRack: "loc_central_rack",
  riversideWarehouse: "wh_riverside",
  riversideLocation: "loc_riverside_main",
  postedReceipt: "rcpt_001",
  draftReceipt: "rcpt_draft",
  postedIssue: "iss_001",
  draftIssue: "iss_draft",
  postedReturn: "ret_001",
  postedTransfer: "trf_001",
  draftTransfer: "trf_draft",
  postedAdjustment: "adj_count",
  draftAdjustment: "adj_draft",
  activeReservation: "rsv_001",
  companyBItem: "item_b_001",
  companyBWarehouse: "wh_b_central",
  companyBMovement: "mv_b_001",
  projectA: "project_a",
} as const;

const created = {
  items: [] as string[],
  warehouses: [] as string[],
  locations: [] as string[],
  receipts: [] as string[],
  issues: [] as string[],
  returns: [] as string[],
  transfers: [] as string[],
  adjustments: [] as string[],
  reservations: [] as string[],
};

/**
 * Restores anything a test changed on a *seeded* record.
 *
 * The suite runs against the shared development database, so a test that posts
 * a seeded draft has to put it back — otherwise the next run finds a document
 * that is already posted and the failure looks like a product bug.
 */
const touchedDocuments: { model: string; id: string; status: string }[] = [];

async function rememberDocument(
  model: "receipt" | "issue" | "return" | "transfer" | "adjustment",
  id: string,
) {
  const row =
    model === "receipt"
      ? await prisma.inventoryReceipt.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        })
      : model === "issue"
        ? await prisma.stockIssue.findUniqueOrThrow({
            where: { id },
            select: { status: true },
          })
        : model === "return"
          ? await prisma.stockReturn.findUniqueOrThrow({
              where: { id },
              select: { status: true },
            })
          : model === "transfer"
            ? await prisma.stockTransfer.findUniqueOrThrow({
                where: { id },
                select: { status: true },
              })
            : await prisma.stockAdjustment.findUniqueOrThrow({
                where: { id },
                select: { status: true },
              });

  touchedDocuments.push({ model, id, status: row.status });
}

/** Reprojects every balance from the ledger, exactly as the seed does. */
async function reprojectBalances() {
  const sums = await prisma.stockMovement.groupBy({
    by: ["inventoryItemId", "locationId"],
    _sum: { signedQuantity: true },
  });

  for (const row of sums) {
    const held = await prisma.stockReservation.aggregate({
      where: {
        inventoryItemId: row.inventoryItemId,
        locationId: row.locationId,
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
      _sum: { quantity: true, fulfilledQuantity: true },
    });

    const reserved = (held._sum.quantity ?? new Prisma.Decimal(0)).minus(
      held._sum.fulfilledQuantity ?? new Prisma.Decimal(0),
    );
    const onHand = row._sum.signedQuantity ?? new Prisma.Decimal(0);

    await prisma.inventoryBalance.updateMany({
      where: {
        inventoryItemId: row.inventoryItemId,
        locationId: row.locationId,
      },
      data: {
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: onHand.minus(reserved),
      },
    });
  }
}

afterEach(async () => {
  const documentIds = [
    ...created.receipts,
    ...created.issues,
    ...created.returns,
    ...created.transfers,
    ...created.adjustments,
  ];

  if (documentIds.length > 0) {
    await prisma.stockMovement.deleteMany({
      where: { sourceEntityId: { in: documentIds } },
    });
    await prisma.activity.deleteMany({
      where: { entityId: { in: documentIds } },
    });
  }

  if (created.receipts.length > 0) {
    await prisma.inventoryReceiptLine.deleteMany({
      where: { inventoryReceiptId: { in: created.receipts } },
    });
    await prisma.inventoryReceipt.deleteMany({
      where: { id: { in: created.receipts } },
    });
    created.receipts.length = 0;
  }
  if (created.issues.length > 0) {
    await prisma.stockIssueLine.deleteMany({
      where: { stockIssueId: { in: created.issues } },
    });
    await prisma.stockIssue.deleteMany({
      where: { id: { in: created.issues } },
    });
    created.issues.length = 0;
  }
  if (created.returns.length > 0) {
    await prisma.stockReturnLine.deleteMany({
      where: { stockReturnId: { in: created.returns } },
    });
    await prisma.stockReturn.deleteMany({
      where: { id: { in: created.returns } },
    });
    created.returns.length = 0;
  }
  if (created.transfers.length > 0) {
    await prisma.stockTransferLine.deleteMany({
      where: { stockTransferId: { in: created.transfers } },
    });
    await prisma.stockTransfer.deleteMany({
      where: { id: { in: created.transfers } },
    });
    created.transfers.length = 0;
  }
  if (created.adjustments.length > 0) {
    await prisma.stockAdjustmentLine.deleteMany({
      where: { stockAdjustmentId: { in: created.adjustments } },
    });
    await prisma.stockAdjustment.deleteMany({
      where: { id: { in: created.adjustments } },
    });
    created.adjustments.length = 0;
  }
  if (created.reservations.length > 0) {
    await prisma.activity.deleteMany({
      where: { entityId: { in: created.reservations } },
    });
    await prisma.stockReservation.deleteMany({
      where: { id: { in: created.reservations } },
    });
    created.reservations.length = 0;
  }
  if (created.locations.length > 0) {
    await prisma.inventoryLocation.deleteMany({
      where: { id: { in: created.locations } },
    });
    created.locations.length = 0;
  }
  if (created.warehouses.length > 0) {
    await prisma.inventoryLocation.deleteMany({
      where: { warehouseId: { in: created.warehouses } },
    });
    await prisma.activity.deleteMany({
      where: { entityId: { in: created.warehouses } },
    });
    await prisma.warehouse.deleteMany({
      where: { id: { in: created.warehouses } },
    });
    created.warehouses.length = 0;
  }
  if (created.items.length > 0) {
    await prisma.inventoryBalance.deleteMany({
      where: { inventoryItemId: { in: created.items } },
    });
    await prisma.activity.deleteMany({
      where: { entityId: { in: created.items } },
    });
    await prisma.inventoryItem.deleteMany({
      where: { id: { in: created.items } },
    });
    created.items.length = 0;
  }

  for (const row of touchedDocuments) {
    const data = {
      status: row.status as "DRAFT",
      postedAt: null,
      reversedAt: null,
      cancelledAt: null,
    };
    if (row.model === "receipt")
      await prisma.inventoryReceipt.update({ where: { id: row.id }, data });
    if (row.model === "issue")
      await prisma.stockIssue.update({ where: { id: row.id }, data });
    if (row.model === "return")
      await prisma.stockReturn.update({
        where: { id: row.id },
        data: { status: row.status as "DRAFT" },
      });
    if (row.model === "transfer")
      await prisma.stockTransfer.update({ where: { id: row.id }, data });
    if (row.model === "adjustment")
      await prisma.stockAdjustment.update({ where: { id: row.id }, data });
  }
  touchedDocuments.length = 0;

  await reprojectBalances();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Items and warehouses                                                        */
/* -------------------------------------------------------------------------- */

describe("items (PRD #20 §354)", () => {
  it("lists items with stock for a reader who may see balances", async () => {
    const context = await loginAs("INVENTORY");
    const result = await items.listItems(context, itemQuery);

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.stock !== null)).toBe(true);
  });

  it("redacts stock by absence, not by a blank figure (§20)", async () => {
    const context = await loginAs("VIEWER");
    if (!can(context, "inventory.item.view")) return;

    const result = await items.listItems(context, itemQuery);
    expect(result.data.every((row) => row.stock === null)).toBe(true);
  });

  it("refuses a duplicate SKU (§27)", async () => {
    const context = await loginAs("INVENTORY");

    await expect(
      items.createItem(
        context,
        itemSchema.parse({
          sku: "MAT-001",
          name: "Vitest duplicate",
          category: "MATERIAL",
          baseUnit: "bag",
        }),
      ),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("locks the base unit once stock has moved (§46)", async () => {
    const context = await loginAs("INVENTORY");
    const item = await items.getItem(context, SEED.item);

    await expect(
      items.updateItem(
        context,
        SEED.item,
        itemSchema.parse({
          sku: item.sku,
          name: item.name,
          category: item.category,
          baseUnit: "tonne",
          versionUpdatedAt: item.updatedAt,
        }),
      ),
    ).rejects.toMatchObject({ details: { code: "BASE_UNIT_IMMUTABLE" } });
  });

  it("refuses to archive an item that is still holding stock (§47)", async () => {
    const context = await loginAs("INVENTORY");
    await expect(items.archiveItem(context, SEED.item)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("reports low stock only where a threshold was set, and out of stock always (§168, §169)", async () => {
    const context = await loginAs("INVENTORY");
    const low = await items.listItems(
      context,
      itemListQuerySchema.parse({ view: "low-stock", limit: 100 }),
    );

    expect(low.data.length).toBeGreaterThan(0);
    expect(low.data.every((row) => row.level !== "NOT_TRACKED")).toBe(true);

    for (const row of low.data) {
      // Nothing on hand is reported whatever the thresholds say — an empty
      // shelf is a fact, not a comparison (§169). Anything else is only "low"
      // against a number the company actually chose (§168).
      if (row.level === "OUT_OF_STOCK") continue;
      expect(row.minimumStock !== null || row.reorderPoint !== null).toBe(true);
    }
  });
});

describe("warehouses (PRD #20 §355)", () => {
  it("creates a warehouse with a default location, so it can take stock at once (§64)", async () => {
    const context = await loginAs("INVENTORY");

    const warehouse = await warehouses.createWarehouse(
      context,
      warehouseSchema.parse({
        code: `VITEST-${Date.now()}`,
        name: "Vitest store",
        warehouseType: "TEMPORARY",
      }),
    );
    created.warehouses.push(warehouse.id);

    expect(warehouse.locations.length).toBe(1);
    expect(warehouse.locations[0]!.isDefault).toBe(true);
  });

  it("refuses a project-site warehouse with no project (§53)", () => {
    // The rule lives in the schema, which is the boundary every caller crosses
    // — the service is handed input that has already been parsed.
    const parsed = warehouseSchema.safeParse({
      code: "VITEST-NOPROJ",
      name: "Vitest siteless store",
      warehouseType: "PROJECT_SITE",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.projectId?.[0]).toMatch(
        /needs a project/i,
      );
    }
  });

  it("refuses to archive a warehouse that is still holding stock (§59)", async () => {
    const context = await loginAs("INVENTORY");
    await expect(
      warehouses.archiveWarehouse(context, SEED.centralWarehouse),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

/* -------------------------------------------------------------------------- */
/* The ledger and its projection                                               */
/* -------------------------------------------------------------------------- */

describe("ledger and balances (PRD #20 §364, §365)", () => {
  it("every balance equals the sum of its movements (§83)", async () => {
    const context = await loginAs("INVENTORY");

    const rows = await movements.listBalances(
      context,
      balanceListQuerySchema.parse({ heldOnly: false, limit: 500 }),
    );
    expect(rows.data.length).toBeGreaterThan(0);

    for (const balance of rows.data) {
      const sum = await prisma.stockMovement.aggregate({
        where: {
          inventoryItemId: balance.item.id,
          locationId: balance.location.id,
        },
        _sum: { signedQuantity: true },
      });

      const expected = sum._sum.signedQuantity ?? new Prisma.Decimal(0);
      expect(new Prisma.Decimal(balance.onHand).equals(expected)).toBe(true);
    }
  });

  it("no balance is ever negative (§77, §378)", async () => {
    const negatives = await prisma.inventoryBalance.count({
      where: {
        OR: [{ onHandQuantity: { lt: 0 } }, { availableQuantity: { lt: 0 } }],
      },
    });
    expect(negatives).toBe(0);
  });

  it("available is on hand less what is reserved (§76)", async () => {
    const context = await loginAs("INVENTORY");
    const rows = await movements.listBalances(context, balanceQuery);

    for (const balance of rows.data) {
      const expected = new Prisma.Decimal(balance.onHand).minus(
        balance.reserved,
      );
      expect(new Prisma.Decimal(balance.available).equals(expected)).toBe(true);
    }
  });

  it("rebuilding a balance from the ledger reproduces it exactly (§82)", async () => {
    const context = await loginAs("INVENTORY");

    const before = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.item, locationId: SEED.centralLocation },
      select: {
        onHandQuantity: true,
        reservedQuantity: true,
        availableQuantity: true,
      },
    });

    await prisma.$transaction(async (tx) => {
      await balances.rebuildBalance(tx, context, {
        inventoryItemId: SEED.item,
        locationId: SEED.centralLocation,
      });
    });

    const after = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.item, locationId: SEED.centralLocation },
      select: {
        onHandQuantity: true,
        reservedQuantity: true,
        availableQuantity: true,
      },
    });

    expect(after.onHandQuantity.equals(before.onHandQuantity)).toBe(true);
    expect(after.reservedQuantity.equals(before.reservedQuantity)).toBe(true);
    expect(after.availableQuantity.equals(before.availableQuantity)).toBe(true);
  });

  it("serialises every quantity as a string, never a float (§272, §377)", async () => {
    const context = await loginAs("INVENTORY");
    const rows = await movements.listBalances(context, balanceQuery);

    for (const balance of rows.data.slice(0, 5)) {
      expect(typeof balance.onHand).toBe("string");
      expect(typeof balance.reserved).toBe("string");
      expect(typeof balance.available).toBe("string");
    }
  });

  it("carries direction in the signed quantity (§71)", async () => {
    const context = await loginAs("INVENTORY");
    const result = await movements.listMovements(context, movementQuery);

    for (const movement of result.data) {
      const outward =
        movement.movementType === "ISSUE" ||
        movement.movementType === "TRANSFER_OUT" ||
        movement.movementType === "ADJUSTMENT_OUT";

      expect(movement.signedQuantity.startsWith("-")).toBe(outward);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Posting                                                                     */
/* -------------------------------------------------------------------------- */

describe("posting (PRD #20 §356, §358, §361, §362)", () => {
  it("a draft moves no stock until it is posted (§281)", async () => {
    const context = await loginAs("INVENTORY");

    const before = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true },
    });

    const receipt = await receipts.createReceipt(
      context,
      receiptSchema.parse({
        warehouseId: SEED.centralWarehouse,
        receiptDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: "25",
          },
        ],
      }),
    );
    created.receipts.push(receipt.id);

    const unchanged = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true },
    });
    expect(unchanged.onHandQuantity.equals(before.onHandQuantity)).toBe(true);

    await receipts.postReceipt(context, receipt.id);

    const after = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true },
    });
    expect(after.onHandQuantity.equals(before.onHandQuantity.plus(25))).toBe(
      true,
    );
  });

  it("refuses to post the same document twice (§91)", async () => {
    const context = await loginAs("INVENTORY");

    const receipt = await receipts.createReceipt(
      context,
      receiptSchema.parse({
        warehouseId: SEED.centralWarehouse,
        receiptDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: "5",
          },
        ],
      }),
    );
    created.receipts.push(receipt.id);

    await receipts.postReceipt(context, receipt.id);
    await expect(
      receipts.postReceipt(context, receipt.id),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses to edit a posted document (§98)", async () => {
    const context = await loginAs("INVENTORY");

    const receipt = await receipts.createReceipt(
      context,
      receiptSchema.parse({
        warehouseId: SEED.centralWarehouse,
        receiptDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: "5",
          },
        ],
      }),
    );
    created.receipts.push(receipt.id);
    await receipts.postReceipt(context, receipt.id);

    await expect(
      receipts.updateReceipt(
        context,
        receipt.id,
        receiptSchema.parse({
          warehouseId: SEED.centralWarehouse,
          receiptDate: "2026-09-12",
          lines: [
            {
              inventoryItemId: SEED.paper,
              locationId: SEED.centralLocation,
              quantity: "9",
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("refuses an issue with more than is available (§115, §334)", async () => {
    const context = await loginAs("INVENTORY");

    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { availableQuantity: true },
    });

    const issue = await issues.createIssue(
      context,
      issueSchema.parse({
        warehouseId: SEED.centralWarehouse,
        issueDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: balance.availableQuantity.plus(1000).toFixed(4),
          },
        ],
      }),
    );
    created.issues.push(issue.id);

    await expect(issues.postIssue(context, issue.id)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("a transfer writes a paired movement and preserves the company total (§137, §138)", async () => {
    const context = await loginAs("INVENTORY");

    const totalBefore = await prisma.stockMovement.aggregate({
      where: { inventoryItemId: SEED.item, companyId: context.companyId },
      _sum: { signedQuantity: true },
    });

    const transfer = await transfers.createTransfer(
      context,
      transferSchema.parse({
        fromWarehouseId: SEED.centralWarehouse,
        toWarehouseId: SEED.riversideWarehouse,
        transferDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.item,
            fromLocationId: SEED.centralLocation,
            toLocationId: SEED.riversideLocation,
            quantity: "10",
          },
        ],
      }),
    );
    created.transfers.push(transfer.id);

    await transfers.postTransfer(context, transfer.id);

    const written = await prisma.stockMovement.findMany({
      where: { sourceEntityId: transfer.id },
      select: { movementType: true, signedQuantity: true },
    });

    expect(written.length).toBe(2);
    expect(written.some((row) => row.movementType === "TRANSFER_OUT")).toBe(
      true,
    );
    expect(written.some((row) => row.movementType === "TRANSFER_IN")).toBe(
      true,
    );

    const totalAfter = await prisma.stockMovement.aggregate({
      where: { inventoryItemId: SEED.item, companyId: context.companyId },
      _sum: { signedQuantity: true },
    });

    expect(
      (totalAfter._sum.signedQuantity ?? new Prisma.Decimal(0)).equals(
        totalBefore._sum.signedQuantity ?? new Prisma.Decimal(0),
      ),
    ).toBe(true);
  });

  it("refuses a transfer line that moves stock to where it already is (§135)", () => {
    const parsed = transferSchema.safeParse({
      fromWarehouseId: SEED.centralWarehouse,
      toWarehouseId: SEED.centralWarehouse,
      transferDate: "2026-09-12",
      lines: [
        {
          inventoryItemId: SEED.item,
          fromLocationId: SEED.centralLocation,
          toLocationId: SEED.centralLocation,
          quantity: "1",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.lines?.[0]).toMatch(
        /already in/i,
      );
    }
  });

  it("refuses a negative adjustment that would take stock below zero (§148)", async () => {
    const context = await loginAs("INVENTORY");

    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true },
    });

    const adjustment = await adjustments.createAdjustment(
      context,
      adjustmentSchema.parse({
        warehouseId: SEED.centralWarehouse,
        adjustmentDate: "2026-09-12",
        reason: "LOSS",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantityDelta: balance.onHandQuantity
              .plus(500)
              .negated()
              .toFixed(4),
          },
        ],
      }),
    );
    created.adjustments.push(adjustment.id);

    await expect(
      adjustments.postAdjustment(context, adjustment.id),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("reverses by writing opposite movements, never by erasing (§70, §101)", async () => {
    const context = await loginAs("INVENTORY");

    const receipt = await receipts.createReceipt(
      context,
      receiptSchema.parse({
        warehouseId: SEED.centralWarehouse,
        receiptDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: "7",
          },
        ],
      }),
    );
    created.receipts.push(receipt.id);

    await receipts.postReceipt(context, receipt.id);
    await receipts.reverseReceipt(context, receipt.id);

    const written = await prisma.stockMovement.findMany({
      where: { sourceEntityId: receipt.id },
      select: { signedQuantity: true },
    });

    expect(written.length).toBe(2);
    const total = written.reduce(
      (running, row) => running.plus(row.signedQuantity),
      new Prisma.Decimal(0),
    );
    expect(total.isZero()).toBe(true);
  });

  it("refuses to reverse the same document twice (§382)", async () => {
    const context = await loginAs("INVENTORY");

    const receipt = await receipts.createReceipt(
      context,
      receiptSchema.parse({
        warehouseId: SEED.centralWarehouse,
        receiptDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.paper,
            locationId: SEED.centralLocation,
            quantity: "3",
          },
        ],
      }),
    );
    created.receipts.push(receipt.id);

    await receipts.postReceipt(context, receipt.id);
    await receipts.reverseReceipt(context, receipt.id);
    await expect(
      receipts.reverseReceipt(context, receipt.id),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("a posted return increases stock (§126)", async () => {
    const context = await loginAs("INVENTORY");

    const before = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.item, locationId: SEED.riversideLocation },
      select: { onHandQuantity: true },
    });

    const record = await returns.createReturn(
      context,
      returnSchema.parse({
        warehouseId: SEED.riversideWarehouse,
        projectId: SEED.projectA,
        returnDate: "2026-09-12",
        lines: [
          {
            inventoryItemId: SEED.item,
            locationId: SEED.riversideLocation,
            quantity: "4",
          },
        ],
      }),
    );
    created.returns.push(record.id);

    await returns.postReturn(context, record.id);

    const after = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.item, locationId: SEED.riversideLocation },
      select: { onHandQuantity: true },
    });

    expect(after.onHandQuantity.equals(before.onHandQuantity.plus(4))).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

describe("reservations (PRD #20 §363, §379)", () => {
  it("holds quantity back from available without moving stock (§166)", async () => {
    const context = await loginAs("INVENTORY");

    const before = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true, availableQuantity: true },
    });

    const reservation = await reservations.createReservation(
      context,
      reservationSchema.parse({
        inventoryItemId: SEED.paper,
        warehouseId: SEED.centralWarehouse,
        locationId: SEED.centralLocation,
        quantity: "3",
      }),
    );
    created.reservations.push(reservation.id);

    const after = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { onHandQuantity: true, availableQuantity: true },
    });

    expect(after.onHandQuantity.equals(before.onHandQuantity)).toBe(true);
    expect(
      after.availableQuantity.equals(before.availableQuantity.minus(3)),
    ).toBe(true);
  });

  it("refuses to oversubscribe what is available (§159)", async () => {
    const context = await loginAs("INVENTORY");

    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { availableQuantity: true },
    });

    await expect(
      reservations.createReservation(
        context,
        reservationSchema.parse({
          inventoryItemId: SEED.paper,
          warehouseId: SEED.centralWarehouse,
          locationId: SEED.centralLocation,
          quantity: balance.availableQuantity.plus(1000).toFixed(4),
        }),
      ),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("returns the quantity to available when released (§161)", async () => {
    const context = await loginAs("INVENTORY");

    const before = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { availableQuantity: true },
    });

    const reservation = await reservations.createReservation(
      context,
      reservationSchema.parse({
        inventoryItemId: SEED.paper,
        warehouseId: SEED.centralWarehouse,
        locationId: SEED.centralLocation,
        quantity: "6",
      }),
    );
    created.reservations.push(reservation.id);
    await reservations.release(context, reservation.id);

    const after = await prisma.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: SEED.paper, locationId: SEED.centralLocation },
      select: { availableQuantity: true },
    });

    expect(after.availableQuantity.equals(before.availableQuantity)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorisation                                                               */
/* -------------------------------------------------------------------------- */

describe("authorisation (PRD #20 §367, §383)", () => {
  it("a Finance reader cannot mutate stock (§304)", async () => {
    const context = await loginAs("FINANCE");
    expect(can(context, "inventory.adjustment.post")).toBe(false);
    expect(can(context, "inventory.issue.post")).toBe(false);
    expect(can(context, "inventory.movement.create")).toBe(false);
  });

  it("Group IT holds no inventory business access by default (§17)", async () => {
    const context = await loginAs("GROUP_IT");
    expect(can(context, "inventory.item.view")).toBe(false);
    expect(can(context, "inventory.balance.view")).toBe(false);
    // The Platform Admin has no company membership to reach it from at all.
    await expect(loginAs("PLATFORM_ADMIN")).rejects.toThrow();
  });

  it("a Procurement reader does not gain full warehouse access (§303)", async () => {
    const context = await loginAs("PROCUREMENT");
    expect(can(context, "inventory.adjustment.post")).toBe(false);
    expect(can(context, "inventory.warehouse.create")).toBe(false);
  });

  it("posting is separated from drafting (§281)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    if (can(context, "inventory.issue.create")) {
      expect(can(context, "inventory.issue.post")).toBe(false);
    }
  });

  it("a project reader sees only the warehouses their projects reach (§246)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    if (!can(context, "inventory.warehouse.view")) return;

    const result = await warehouses.listWarehouses(context, warehouseQuery);
    const reachable = result.data.map((row) => row.id);

    const inventoryContext = await loginAs("INVENTORY");
    const all = await warehouses.listWarehouses(
      inventoryContext,
      warehouseQuery,
    );

    expect(reachable.length).toBeLessThanOrEqual(all.data.length);
    expect(reachable.every((id) => all.data.some((row) => row.id === id))).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Company isolation                                                           */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #20 §298, §383)", () => {
  it("never lists a Company B item, warehouse or movement", async () => {
    const context = await loginAs("OWNER");

    const [itemRows, warehouseRows, movementRows, balanceRows] =
      await Promise.all([
        items.listItems(context, itemQuery),
        warehouses.listWarehouses(context, warehouseQuery),
        movements.listMovements(context, movementQuery),
        movements.listBalances(context, balanceQuery),
      ]);

    expect(itemRows.data.some((row) => row.id === SEED.companyBItem)).toBe(
      false,
    );
    expect(
      warehouseRows.data.some((row) => row.id === SEED.companyBWarehouse),
    ).toBe(false);
    expect(
      movementRows.data.some((row) => row.id === SEED.companyBMovement),
    ).toBe(false);
    expect(
      balanceRows.data.some((row) => row.item.id === SEED.companyBItem),
    ).toBe(false);
  });

  it("answers 404, not 403, for a Company B record (§298)", async () => {
    const context = await loginAs("OWNER");

    await expect(
      items.getItem(context, SEED.companyBItem),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      warehouses.getWarehouse(context, SEED.companyBWarehouse),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not leak Company B through search (§296, §374)", async () => {
    const context = await loginAs("OWNER");

    const result = await items.listItems(
      context,
      itemListQuerySchema.parse({ search: "Company B", limit: 100 }),
    );
    expect(result.data.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

describe("overview and reports (PRD #20 §376)", () => {
  it("counts through the reader's own scope", async () => {
    const inventory = await inventoryOverview(await loginAs("INVENTORY"));
    expect(inventory.activeItems).toBeGreaterThan(0);
    expect(inventory.visible.stock).toBe(true);

    // A project-scoped reader counts the same figures through a narrower
    // window, and never sees more than the company-scope storeman does.
    const pm = await inventoryOverview(await loginAs("PROJECT_MANAGER"));
    expect(pm.warehouses).toBeLessThanOrEqual(inventory.warehouses);
    expect(pm.movementsThisMonth).toBeLessThanOrEqual(inventory.movementsThisMonth);
  });

  it("refuses a reader with no inventory access at all", async () => {
    const context = await loginAs("GROUP_IT");
    await expect(inventoryOverview(context)).rejects.toBeInstanceOf(AccessError);
  });

  it("reports no stock value, because V0.1 has no costing method (§186)", async () => {
    const overview = await inventoryOverview(await loginAs("INVENTORY"));
    expect(Object.keys(overview)).not.toContain("stockValue");
  });

  it("counts project consumption as issued less returned (§185)", async () => {
    const context = await loginAs("INVENTORY");
    const rows = await projectConsumption(context, SEED.projectA);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const expected = new Prisma.Decimal(row.issued).minus(row.returned);
      expect(new Prisma.Decimal(row.netIssued).equals(expected)).toBe(true);
    }
  });

  it("scopes every report to the reader", async () => {
    const inventory = await inventoryReports(await loginAs("INVENTORY"));
    expect(inventory.stockByWarehouse.length).toBeGreaterThan(0);

    const pm = await loginAs("PROJECT_MANAGER");
    if (!can(pm, "inventory.report.view")) return;

    const scoped = await inventoryReports(pm);
    expect(scoped.stockByWarehouse.length).toBeLessThanOrEqual(
      inventory.stockByWarehouse.length,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Documents and transactions                                                  */
/* -------------------------------------------------------------------------- */

describe("document lists (PRD #20 §262)", () => {
  it("lists every stock document kind for a reader who holds them", async () => {
    const context = await loginAs("INVENTORY");

    const [
      receiptRows,
      issueRows,
      returnRows,
      transferRows,
      adjustmentRows,
      reservationRows,
    ] = await Promise.all([
      receipts.listReceipts(context, transactionQuery),
      issues.listIssues(context, transactionQuery),
      returns.listReturns(context, transactionQuery),
      transfers.listTransfers(context, transactionQuery),
      adjustments.listAdjustments(context, transactionQuery),
      reservations.listReservations(context, reservationQuery),
    ]);

    expect(receiptRows.data.length).toBeGreaterThan(0);
    expect(issueRows.data.length).toBeGreaterThan(0);
    expect(returnRows.data.length).toBeGreaterThan(0);
    expect(transferRows.data.length).toBeGreaterThan(0);
    expect(adjustmentRows.data.length).toBeGreaterThan(0);
    expect(reservationRows.data.length).toBeGreaterThan(0);
  });

  it("gives every posted document the lines that produced its movements (§293)", async () => {
    const context = await loginAs("INVENTORY");
    const posted = await receipts.listReceipts(
      context,
      transactionListQuerySchema.parse({ status: ["POSTED"], limit: 20 }),
    );

    expect(posted.data.length).toBeGreaterThan(0);
    for (const row of posted.data) {
      expect(row.lineCount).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads a CSV by column name.
 *
 * Indexing by position would make these tests break whenever a column moves,
 * and a quoted cell containing a comma would silently shift every index after
 * it.
 */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;

    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body.map((entry) =>
    Object.fromEntries(headers!.map((name, index) => [name, entry[index] ?? ""])),
  );
}

describe("CSV export (PRD #20 §214, §215)", () => {
  it("writes the same rows the list shows", async () => {
    const context = await loginAs("INVENTORY");

    const { filename, csv } = await exportInventory(context, "items", {
      items: itemListQuerySchema.parse({ limit: 500 }),
    });

    expect(filename).toMatch(/^inventory-items-\d{4}-\d{2}-\d{2}\.csv$/);

    const rows = parseCsv(csv);
    expect(csv.split("\n")[0]).toContain("SKU");
    expect(csv.split("\n")[0]).toContain("On hand");

    const listed = await items.listItems(context, itemListQuerySchema.parse({ limit: 500 }));
    expect(rows.length).toBe(listed.data.length);
  });

  it("omits the stock columns entirely for a reader who may not see them (§20, §215)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    if (!can(context, "inventory.export") || !can(context, "inventory.item.view")) return;

    const { csv } = await exportInventory(context, "items", {
      items: itemListQuerySchema.parse({ limit: 500 }),
    });

    const header = csv.split("\n")[0]!;
    if (can(context, "inventory.balance.view")) {
      expect(header).toContain("On hand");
    } else {
      // Absence, not a blank column: an empty cell would imply zero.
      expect(header).not.toContain("On hand");
    }
  });

  it("never exports a Company B row (§215, §298)", async () => {
    const context = await loginAs("OWNER");

    const { csv } = await exportInventory(context, "items", {
      items: itemListQuerySchema.parse({ limit: 500 }),
    });

    expect(csv).not.toContain("Company B item");
  });

  it("writes quantities as decimal strings, never floats (§272)", async () => {
    const context = await loginAs("INVENTORY");

    const { csv } = await exportInventory(context, "balances", {
      balances: balanceListQuerySchema.parse({ limit: 500 }),
    });

    const rows = parseCsv(csv);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows.slice(0, 5)) {
      for (const column of ["On hand", "Reserved", "Available"]) {
        expect(row[column]).toMatch(/^-?\d+(\.\d+)?$/);
      }
    }
  });

  it("carries the sign on an exported movement, so a column sums to the balance (§71)", async () => {
    const context = await loginAs("INVENTORY");

    const { csv } = await exportInventory(context, "movements", {
      movements: movementListQuerySchema.parse({ movementType: ["ISSUE"], limit: 50 }),
    });

    const rows = parseCsv(csv);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.Quantity).toMatch(/^-/);
    }
  });

  it("refuses a reader without the export grant (§215)", async () => {
    const context = await loginAs("VIEWER");

    await expect(
      exportInventory(context, "items", { items: itemListQuerySchema.parse({ limit: 10 }) }),
    ).rejects.toBeInstanceOf(AccessError);
  });
});
