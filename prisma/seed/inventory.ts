/**
 * Inventory fixtures (PRD #20 §301–§307).
 *
 * The point of this seed is that **the ledger and the balances agree**. Every
 * balance row here is computed from the movements written beside it, exactly
 * the way the balance service computes it at runtime — so the demo data is a
 * valid state of the system rather than a set of numbers that happen to look
 * plausible (PRD #20 §83).
 *
 *   items        18 across six categories, with minimum and reorder levels set
 *                so the low-stock screen has something to show (§167)
 *   warehouses   5 — one central store, three project sites, one office —
 *                each with locations (§49, §64)
 *   movements    an opening balance per item, then receipts, issues, returns,
 *                transfers and adjustments, so the ledger reads like a history
 *   documents    posted and draft examples of every kind (§280)
 *   reservations active, partly fulfilled and expired (§154)
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it converges rather than duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";

type Members = Map<string, string>;

const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));
const ZERO = new Prisma.Decimal(0);

export async function seedInventoryRecords(prisma: PrismaClient, members: Members) {
  const inventory = members.get("user_inventory")!;
  const pm = members.get("user_pm")!;
  const procurement = members.get("user_procurement")!;

  await seedWarehouses(prisma, inventory);
  await seedItems(prisma, inventory);
  const ledger = await seedLedger(prisma, { inventory, pm, procurement });
  await seedDocuments(prisma, { inventory, pm });
  await seedReservations(prisma, inventory);
  await rebuildBalances(prisma, COMPANY_A);
  await seedCompanyBInventory(prisma);
  await rebuildBalances(prisma, COMPANY_B);

  return {
    items: await prisma.inventoryItem.count({ where: { companyId: COMPANY_A } }),
    warehouses: await prisma.warehouse.count({ where: { companyId: COMPANY_A } }),
    movements: ledger,
    balances: await prisma.inventoryBalance.count({ where: { companyId: COMPANY_A } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Warehouses and locations                                                    */
/* -------------------------------------------------------------------------- */

type WarehouseFixture = {
  id: string;
  code: string;
  name: string;
  type: "CENTRAL" | "PROJECT_SITE" | "OFFICE" | "TEMPORARY" | "OTHER";
  project?: string;
  city: string;
  locations: { id: string; code: string; name: string; isDefault?: boolean }[];
};

const WAREHOUSES: WarehouseFixture[] = [
  {
    id: "wh_central", code: "WH-CEN", name: "Central store — Tirana", type: "CENTRAL", city: "Tirana",
    locations: [
      { id: "loc_central_main", code: "MAIN", name: "Main area", isDefault: true },
      { id: "loc_central_rack", code: "RACK-A", name: "Racking A" },
      { id: "loc_central_yard", code: "YARD", name: "External yard" },
    ],
  },
  {
    id: "wh_riverside", code: "WH-RIV", name: "Riverside site store", type: "PROJECT_SITE", project: PROJECT_IDS.a, city: "Tirana",
    locations: [
      { id: "loc_riverside_main", code: "MAIN", name: "Site container", isDefault: true },
      { id: "loc_riverside_yard", code: "YARD", name: "Laydown area" },
    ],
  },
  {
    id: "wh_tower", code: "WH-TWR", name: "Central Office Tower store", type: "PROJECT_SITE", project: PROJECT_IDS.b, city: "Tirana",
    locations: [{ id: "loc_tower_main", code: "MAIN", name: "Basement store", isDefault: true }],
  },
  {
    id: "wh_marina", code: "WH-MAR", name: "Marina site store", type: "PROJECT_SITE", project: PROJECT_IDS.c, city: "Durrës",
    locations: [{ id: "loc_marina_main", code: "MAIN", name: "Site store", isDefault: true }],
  },
  {
    id: "wh_office", code: "WH-OFF", name: "Head office supplies", type: "OFFICE", city: "Tirana",
    locations: [{ id: "loc_office_main", code: "MAIN", name: "Supply cupboard", isDefault: true }],
  },
];

async function seedWarehouses(prisma: PrismaClient, createdBy: string) {
  for (const warehouse of WAREHOUSES) {
    await prisma.warehouse.upsert({
      where: { id: warehouse.id },
      update: {},
      create: {
        id: warehouse.id,
        companyId: COMPANY_A,
        code: warehouse.code,
        name: warehouse.name,
        warehouseType: warehouse.type,
        projectId: warehouse.project ?? null,
        city: warehouse.city,
        country: "Albania",
        status: "ACTIVE",
        createdByMemberId: createdBy,
      },
    });

    for (const location of warehouse.locations) {
      await prisma.inventoryLocation.upsert({
        where: { id: location.id },
        update: {},
        create: {
          id: location.id,
          companyId: COMPANY_A,
          warehouseId: warehouse.id,
          code: location.code,
          name: location.name,
          isDefault: location.isDefault ?? false,
          status: "ACTIVE",
          createdByMemberId: createdBy,
        },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

type ItemFixture = {
  id: string;
  sku: string;
  name: string;
  category: "MATERIAL" | "EQUIPMENT" | "TOOL" | "CONSUMABLE" | "SPARE_PART" | "OFFICE" | "OTHER";
  unit: string;
  minimum?: number;
  reorder?: number;
  status?: "ACTIVE" | "INACTIVE";
};

const ITEMS: ItemFixture[] = [
  { id: "item_cement", sku: "MAT-001", name: "Cement CEM II 42.5", category: "MATERIAL", unit: "bag", minimum: 120, reorder: 240 },
  { id: "item_rebar12", sku: "MAT-002", name: "Rebar B500C 12mm", category: "MATERIAL", unit: "tonne", minimum: 6, reorder: 12 },
  { id: "item_rebar16", sku: "MAT-003", name: "Rebar B500C 16mm", category: "MATERIAL", unit: "tonne", minimum: 8, reorder: 16 },
  { id: "item_sand", sku: "MAT-004", name: "Washed sand 0/4", category: "MATERIAL", unit: "m3", minimum: 30, reorder: 60 },
  { id: "item_block", sku: "MAT-005", name: "Concrete block 200mm", category: "MATERIAL", unit: "each", minimum: 500, reorder: 1200 },
  { id: "item_membrane", sku: "MAT-006", name: "SBS waterproof membrane", category: "MATERIAL", unit: "m2", minimum: 200, reorder: 400 },
  { id: "item_timber", sku: "MAT-007", name: "Formwork plywood 18mm", category: "MATERIAL", unit: "sheet", minimum: 40, reorder: 90 },
  { id: "item_pump", sku: "EQP-001", name: "Submersible pump 15kW", category: "EQUIPMENT", unit: "each", minimum: 1, reorder: 2 },
  { id: "item_genset", sku: "EQP-002", name: "Generator 60kVA", category: "EQUIPMENT", unit: "each", minimum: 1, reorder: 2 },
  { id: "item_scaffold", sku: "EQP-003", name: "Scaffold frame 2m", category: "EQUIPMENT", unit: "each", minimum: 80, reorder: 160 },
  { id: "item_drill", sku: "TOO-001", name: "Rotary hammer drill", category: "TOOL", unit: "each", minimum: 2, reorder: 4 },
  { id: "item_level", sku: "TOO-002", name: "Laser level", category: "TOOL", unit: "each", minimum: 1, reorder: 3 },
  { id: "item_gloves", sku: "CON-001", name: "Work gloves", category: "CONSUMABLE", unit: "pair", minimum: 40, reorder: 100 },
  { id: "item_helmet", sku: "CON-002", name: "Hard hat, vented", category: "CONSUMABLE", unit: "each", minimum: 30, reorder: 60 },
  { id: "item_disc", sku: "CON-003", name: "Cutting disc 230mm", category: "CONSUMABLE", unit: "each", minimum: 50, reorder: 120 },
  { id: "item_filter", sku: "SPA-001", name: "Generator oil filter", category: "SPARE_PART", unit: "each", minimum: 4, reorder: 8 },
  { id: "item_paper", sku: "OFF-001", name: "A4 paper, ream", category: "OFFICE", unit: "ream", minimum: 10, reorder: 25 },
  { id: "item_retired", sku: "MAT-099", name: "Discontinued sealant", category: "MATERIAL", unit: "tube", status: "INACTIVE" },
];

async function seedItems(prisma: PrismaClient, createdBy: string) {
  for (const item of ITEMS) {
    await prisma.inventoryItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        companyId: COMPANY_A,
        sku: item.sku,
        name: item.name,
        category: item.category,
        baseUnit: item.unit,
        status: item.status ?? "ACTIVE",
        minimumStock: item.minimum === undefined ? null : qty(item.minimum),
        reorderPoint: item.reorder === undefined ? null : qty(item.reorder),
        defaultWarehouseId: "wh_central",
        defaultLocationId: "loc_central_main",
        createdByMemberId: createdBy,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* The ledger                                                                  */
/* -------------------------------------------------------------------------- */

type MovementFixture = {
  id: string;
  item: string;
  location: string;
  type: "RECEIPT" | "ISSUE" | "RETURN_TO_STOCK" | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  quantity: number;
  daysAgo: number;
  project?: string;
  source: { entityType: string; entityId: string };
};

const WAREHOUSE_BY_LOCATION: Record<string, string> = Object.fromEntries(
  WAREHOUSES.flatMap((warehouse) =>
    warehouse.locations.map((location) => [location.id, warehouse.id]),
  ),
);

const UNIT_BY_ITEM: Record<string, string> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item.unit]),
);

/** Opening balances, then a plausible few weeks of trading. */
const MOVEMENTS: MovementFixture[] = [
  // Opening balances into the central store.
  ...(
    [
      ["item_cement", 900], ["item_rebar12", 28], ["item_rebar16", 34], ["item_sand", 140],
      ["item_block", 4200], ["item_membrane", 1500], ["item_timber", 260], ["item_pump", 6],
      ["item_genset", 3], ["item_scaffold", 420], ["item_drill", 9], ["item_level", 4],
      ["item_gloves", 320], ["item_helmet", 180], ["item_disc", 600], ["item_filter", 24],
      ["item_paper", 60],
    ] as [string, number][]
  ).map(([item, amount], index) => ({
    id: `mv_open_${index + 1}`,
    item,
    location: "loc_central_main",
    type: "ADJUSTMENT_IN" as const,
    quantity: amount,
    daysAgo: 90,
    source: { entityType: "stock_adjustment", entityId: "adj_opening" },
  })),

  // Deliveries into the central store.
  { id: "mv_rcv_1", item: "item_cement", location: "loc_central_main", type: "RECEIPT", quantity: 600, daysAgo: 40, source: { entityType: "inventory_receipt", entityId: "rcpt_001" } },
  { id: "mv_rcv_2", item: "item_rebar16", location: "loc_central_rack", type: "RECEIPT", quantity: 42, daysAgo: 38, source: { entityType: "inventory_receipt", entityId: "rcpt_001" } },
  { id: "mv_rcv_3", item: "item_block", location: "loc_central_yard", type: "RECEIPT", quantity: 3000, daysAgo: 30, source: { entityType: "inventory_receipt", entityId: "rcpt_002" } },
  { id: "mv_rcv_4", item: "item_helmet", location: "loc_central_main", type: "RECEIPT", quantity: 120, daysAgo: 26, source: { entityType: "inventory_receipt", entityId: "rcpt_003" } },
  { id: "mv_rcv_5", item: "item_gloves", location: "loc_central_main", type: "RECEIPT", quantity: 200, daysAgo: 26, source: { entityType: "inventory_receipt", entityId: "rcpt_003" } },

  // Transfers out to the sites.
  { id: "mv_trf_out_1", item: "item_cement", location: "loc_central_main", type: "TRANSFER_OUT", quantity: 700, daysAgo: 24, source: { entityType: "stock_transfer", entityId: "trf_001" } },
  { id: "mv_trf_in_1", item: "item_cement", location: "loc_riverside_main", type: "TRANSFER_IN", quantity: 700, daysAgo: 24, source: { entityType: "stock_transfer", entityId: "trf_001" } },
  { id: "mv_trf_out_2", item: "item_rebar16", location: "loc_central_rack", type: "TRANSFER_OUT", quantity: 40, daysAgo: 22, source: { entityType: "stock_transfer", entityId: "trf_001" } },
  { id: "mv_trf_in_2", item: "item_rebar16", location: "loc_riverside_yard", type: "TRANSFER_IN", quantity: 40, daysAgo: 22, source: { entityType: "stock_transfer", entityId: "trf_001" } },
  { id: "mv_trf_out_3", item: "item_block", location: "loc_central_yard", type: "TRANSFER_OUT", quantity: 2400, daysAgo: 20, source: { entityType: "stock_transfer", entityId: "trf_002" } },
  { id: "mv_trf_in_3", item: "item_block", location: "loc_tower_main", type: "TRANSFER_IN", quantity: 2400, daysAgo: 20, source: { entityType: "stock_transfer", entityId: "trf_002" } },
  { id: "mv_trf_out_4", item: "item_scaffold", location: "loc_central_main", type: "TRANSFER_OUT", quantity: 200, daysAgo: 18, source: { entityType: "stock_transfer", entityId: "trf_002" } },
  { id: "mv_trf_in_4", item: "item_scaffold", location: "loc_marina_main", type: "TRANSFER_IN", quantity: 200, daysAgo: 18, source: { entityType: "stock_transfer", entityId: "trf_002" } },

  // Issues to projects.
  { id: "mv_iss_1", item: "item_cement", location: "loc_riverside_main", type: "ISSUE", quantity: 520, daysAgo: 16, project: PROJECT_IDS.a, source: { entityType: "stock_issue", entityId: "iss_001" } },
  { id: "mv_iss_2", item: "item_rebar16", location: "loc_riverside_yard", type: "ISSUE", quantity: 30, daysAgo: 15, project: PROJECT_IDS.a, source: { entityType: "stock_issue", entityId: "iss_001" } },
  { id: "mv_iss_3", item: "item_block", location: "loc_tower_main", type: "ISSUE", quantity: 1800, daysAgo: 12, project: PROJECT_IDS.b, source: { entityType: "stock_issue", entityId: "iss_002" } },
  { id: "mv_iss_4", item: "item_scaffold", location: "loc_marina_main", type: "ISSUE", quantity: 160, daysAgo: 10, project: PROJECT_IDS.c, source: { entityType: "stock_issue", entityId: "iss_003" } },
  { id: "mv_iss_5", item: "item_helmet", location: "loc_central_main", type: "ISSUE", quantity: 150, daysAgo: 9, source: { entityType: "stock_issue", entityId: "iss_004" } },
  { id: "mv_iss_6", item: "item_gloves", location: "loc_central_main", type: "ISSUE", quantity: 280, daysAgo: 9, source: { entityType: "stock_issue", entityId: "iss_004" } },
  { id: "mv_iss_7", item: "item_disc", location: "loc_central_main", type: "ISSUE", quantity: 500, daysAgo: 8, source: { entityType: "stock_issue", entityId: "iss_004" } },
  { id: "mv_iss_8", item: "item_paper", location: "loc_central_main", type: "ISSUE", quantity: 48, daysAgo: 7, source: { entityType: "stock_issue", entityId: "iss_004" } },
  { id: "mv_iss_9", item: "item_timber", location: "loc_central_main", type: "ISSUE", quantity: 210, daysAgo: 6, project: PROJECT_IDS.a, source: { entityType: "stock_issue", entityId: "iss_005" } },
  { id: "mv_iss_10", item: "item_membrane", location: "loc_central_main", type: "ISSUE", quantity: 1250, daysAgo: 5, project: PROJECT_IDS.b, source: { entityType: "stock_issue", entityId: "iss_005" } },

  // Some of it comes back.
  { id: "mv_ret_1", item: "item_cement", location: "loc_riverside_main", type: "RETURN_TO_STOCK", quantity: 40, daysAgo: 4, project: PROJECT_IDS.a, source: { entityType: "stock_return", entityId: "ret_001" } },
  { id: "mv_ret_2", item: "item_scaffold", location: "loc_marina_main", type: "RETURN_TO_STOCK", quantity: 25, daysAgo: 3, project: PROJECT_IDS.c, source: { entityType: "stock_return", entityId: "ret_001" } },

  // A stock count found a discrepancy.
  { id: "mv_adj_1", item: "item_sand", location: "loc_central_main", type: "ADJUSTMENT_OUT", quantity: 118, daysAgo: 2, source: { entityType: "stock_adjustment", entityId: "adj_count" } },
  { id: "mv_adj_2", item: "item_filter", location: "loc_central_main", type: "ADJUSTMENT_OUT", quantity: 21, daysAgo: 2, source: { entityType: "stock_adjustment", entityId: "adj_count" } },
];

const DIRECTION: Record<MovementFixture["type"], 1 | -1> = {
  RECEIPT: 1,
  RETURN_TO_STOCK: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  ISSUE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_OUT: -1,
};

async function seedLedger(
  prisma: PrismaClient,
  members: { inventory: string; pm: string; procurement: string },
): Promise<number> {
  for (const movement of MOVEMENTS) {
    const warehouseId = WAREHOUSE_BY_LOCATION[movement.location]!;
    const amount = qty(movement.quantity);

    await prisma.stockMovement.upsert({
      where: { id: movement.id },
      // Converges on a re-run: a corrected fixture has to actually take effect,
      // or the balances stop agreeing with the ledger (PRD #20 §83).
      update: { quantity: amount, signedQuantity: amount.mul(DIRECTION[movement.type]) },
      create: {
        id: movement.id,
        companyId: COMPANY_A,
        inventoryItemId: movement.item,
        warehouseId,
        locationId: movement.location,
        movementType: movement.type,
        quantity: amount,
        signedQuantity: amount.mul(DIRECTION[movement.type]),
        unit: UNIT_BY_ITEM[movement.item]!,
        projectId: movement.project ?? null,
        sourceModule: "inventory",
        sourceEntityType: movement.source.entityType,
        sourceEntityId: movement.source.entityId,
        occurredAt: daysFromNow(-movement.daysAgo),
        postedByMemberId: movement.project ? members.pm : members.inventory,
      },
    });
  }

  return prisma.stockMovement.count({ where: { companyId: COMPANY_A } });
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The documents the ledger rows above point back at, plus a draft of each kind
 * so the posting screens have something to act on (PRD #20 §280).
 */
async function seedDocuments(prisma: PrismaClient, members: { inventory: string; pm: string }) {
  await prisma.stockAdjustment.upsert({
    where: { id: "adj_opening" },
    update: {},
    create: {
      id: "adj_opening", companyId: COMPANY_A, adjustmentNumber: "ADJ-2026-0001",
      warehouseId: "wh_central", adjustmentDate: daysFromNow(-90), reason: "OPENING_BALANCE",
      status: "POSTED", notes: "Opening stock at go-live.",
      createdByMemberId: members.inventory, postedByMemberId: members.inventory,
    },
  });

  await prisma.stockAdjustment.upsert({
    where: { id: "adj_count" },
    update: {},
    create: {
      id: "adj_count", companyId: COMPANY_A, adjustmentNumber: "ADJ-2026-0002",
      warehouseId: "wh_central", adjustmentDate: daysFromNow(-2), reason: "PHYSICAL_COUNT",
      status: "POSTED", notes: "Quarterly count: sand and filters short.",
      createdByMemberId: members.inventory, postedByMemberId: members.inventory,
    },
  });

  await prisma.stockAdjustment.upsert({
    where: { id: "adj_draft" },
    update: {},
    create: {
      id: "adj_draft", companyId: COMPANY_A, adjustmentNumber: "ADJ-2026-0003",
      warehouseId: "wh_central", adjustmentDate: daysFromNow(0), reason: "DAMAGE",
      status: "DRAFT", notes: "Water-damaged cement, pending sign-off.",
      createdByMemberId: members.inventory,
    },
  });

  await prisma.stockAdjustmentLine.upsert({
    where: { id: "adj_draft_line_1" },
    update: {},
    create: {
      id: "adj_draft_line_1", stockAdjustmentId: "adj_draft",
      inventoryItemId: "item_cement", locationId: "loc_central_main",
      quantityDelta: qty(-25), unit: "bag", notes: "Pallet split, bags set.",
    },
  });

  for (const [index, id] of ["rcpt_001", "rcpt_002", "rcpt_003"].entries()) {
    await prisma.inventoryReceipt.upsert({
      where: { id },
      update: {},
      create: {
        id, companyId: COMPANY_A,
        receiptNumber: `GRN-2026-000${index + 1}`,
        warehouseId: "wh_central",
        receiptDate: daysFromNow(-40 + index * 7),
        status: "POSTED", postedAt: daysFromNow(-40 + index * 7),
        createdByMemberId: members.inventory, postedByMemberId: members.inventory,
      },
    });
  }

  await prisma.inventoryReceipt.upsert({
    where: { id: "rcpt_draft" },
    update: {},
    create: {
      id: "rcpt_draft", companyId: COMPANY_A, receiptNumber: "GRN-2026-0004",
      warehouseId: "wh_central", receiptDate: daysFromNow(0), status: "DRAFT",
      notes: "Delivery arrived, awaiting check.",
      createdByMemberId: members.inventory,
    },
  });

  await prisma.inventoryReceiptLine.upsert({
    where: { id: "rcpt_draft_line_1" },
    update: {},
    create: {
      id: "rcpt_draft_line_1", inventoryReceiptId: "rcpt_draft",
      inventoryItemId: "item_sand", locationId: "loc_central_main",
      quantity: qty(80), unit: "m3",
    },
  });

  const issues: [string, string, string | null, number][] = [
    ["iss_001", "wh_riverside", PROJECT_IDS.a, 16],
    ["iss_002", "wh_tower", PROJECT_IDS.b, 12],
    ["iss_003", "wh_marina", PROJECT_IDS.c, 10],
    ["iss_004", "wh_central", null, 9],
    ["iss_005", "wh_central", PROJECT_IDS.a, 6],
  ];

  for (const [index, [id, warehouseId, projectId, daysAgo]] of issues.entries()) {
    await prisma.stockIssue.upsert({
      where: { id },
      update: {},
      create: {
        id, companyId: COMPANY_A, issueNumber: `ISS-2026-000${index + 1}`,
        warehouseId, projectId, issueDate: daysFromNow(-daysAgo),
        status: "POSTED", issuedToMemberId: members.pm,
        createdByMemberId: members.inventory, postedByMemberId: members.inventory,
      },
    });
  }

  await prisma.stockIssue.upsert({
    where: { id: "iss_draft" },
    update: {},
    create: {
      id: "iss_draft", companyId: COMPANY_A, issueNumber: "ISS-2026-0006",
      warehouseId: "wh_central", projectId: PROJECT_IDS.d, issueDate: daysFromNow(0),
      status: "DRAFT", notes: "Requested for the yard drainage works.",
      createdByMemberId: members.inventory,
    },
  });

  await prisma.stockIssueLine.upsert({
    where: { id: "iss_draft_line_1" },
    update: {},
    create: {
      id: "iss_draft_line_1", stockIssueId: "iss_draft",
      inventoryItemId: "item_membrane", locationId: "loc_central_main",
      quantity: qty(120), unit: "m2",
    },
  });

  await prisma.stockReturn.upsert({
    where: { id: "ret_001" },
    update: {},
    create: {
      id: "ret_001", companyId: COMPANY_A, returnNumber: "RET-2026-0001",
      warehouseId: "wh_riverside", projectId: PROJECT_IDS.a, returnDate: daysFromNow(-4),
      status: "POSTED", createdByMemberId: members.pm, postedByMemberId: members.inventory,
    },
  });

  for (const [index, [id, from, to, daysAgo]] of (
    [
      ["trf_001", "wh_central", "wh_riverside", 24],
      ["trf_002", "wh_central", "wh_tower", 20],
    ] as [string, string, string, number][]
  ).entries()) {
    await prisma.stockTransfer.upsert({
      where: { id },
      update: {},
      create: {
        id, companyId: COMPANY_A, transferNumber: `TRF-2026-000${index + 1}`,
        fromWarehouseId: from, toWarehouseId: to, transferDate: daysFromNow(-daysAgo),
        status: "POSTED", createdByMemberId: members.inventory, postedByMemberId: members.inventory,
      },
    });
  }

  await prisma.stockTransfer.upsert({
    where: { id: "trf_draft" },
    update: {},
    create: {
      id: "trf_draft", companyId: COMPANY_A, transferNumber: "TRF-2026-0003",
      fromWarehouseId: "wh_central", toWarehouseId: "wh_marina",
      transferDate: daysFromNow(0), status: "DRAFT",
      createdByMemberId: members.inventory,
    },
  });

  await prisma.stockTransferLine.upsert({
    where: { id: "trf_draft_line_1" },
    update: {},
    create: {
      id: "trf_draft_line_1", stockTransferId: "trf_draft",
      inventoryItemId: "item_drill", fromLocationId: "loc_central_main",
      toLocationId: "loc_marina_main", quantity: qty(2), unit: "each",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

async function seedReservations(prisma: PrismaClient, createdBy: string) {
  const fixtures: {
    id: string; number: string; item: string; location: string; project?: string;
    quantity: number; fulfilled?: number;
    status: "ACTIVE" | "PARTIALLY_FULFILLED" | "EXPIRED" | "RELEASED";
    expiresIn?: number;
  }[] = [
    { id: "rsv_001", number: "RSV-2026-0001", item: "item_cement", location: "loc_central_main", project: PROJECT_IDS.b, quantity: 200, status: "ACTIVE", expiresIn: 21 },
    { id: "rsv_002", number: "RSV-2026-0002", item: "item_timber", location: "loc_central_main", project: PROJECT_IDS.a, quantity: 30, fulfilled: 10, status: "PARTIALLY_FULFILLED", expiresIn: 9 },
    { id: "rsv_003", number: "RSV-2026-0003", item: "item_disc", location: "loc_central_main", quantity: 40, status: "ACTIVE", expiresIn: 3 },
    { id: "rsv_004", number: "RSV-2026-0004", item: "item_pump", location: "loc_central_main", project: PROJECT_IDS.b, quantity: 2, status: "EXPIRED", expiresIn: -5 },
    { id: "rsv_005", number: "RSV-2026-0005", item: "item_genset", location: "loc_central_main", quantity: 1, status: "RELEASED", expiresIn: -20 },
  ];

  for (const reservation of fixtures) {
    await prisma.stockReservation.upsert({
      where: { id: reservation.id },
      update: {},
      create: {
        id: reservation.id,
        companyId: COMPANY_A,
        reservationNumber: reservation.number,
        inventoryItemId: reservation.item,
        warehouseId: WAREHOUSE_BY_LOCATION[reservation.location]!,
        locationId: reservation.location,
        projectId: reservation.project ?? null,
        quantity: qty(reservation.quantity),
        fulfilledQuantity: qty(reservation.fulfilled ?? 0),
        status: reservation.status,
        requiredDate: daysFromNow(reservation.expiresIn ?? 14),
        expiresAt: daysFromNow(reservation.expiresIn ?? 14),
        createdByMemberId: createdBy,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Balances                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Projects the ledger into balances (PRD #20 §79, §82).
 *
 * Exactly what the balance service does at runtime, so the seeded state is one
 * the application could itself have produced. Running it twice converges.
 */
async function rebuildBalances(prisma: PrismaClient, companyId: string) {
  const [movements, reservations, locations] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["inventoryItemId", "locationId"],
      where: { companyId },
      _sum: { signedQuantity: true },
    }),
    prisma.stockReservation.findMany({
      where: { companyId, status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } },
      select: { inventoryItemId: true, locationId: true, quantity: true, fulfilledQuantity: true },
    }),
    prisma.inventoryLocation.findMany({
      where: { companyId },
      select: { id: true, warehouseId: true },
    }),
  ]);

  const warehouseByLocation = new Map(locations.map((row) => [row.id, row.warehouseId]));

  const reservedByKey = new Map<string, Prisma.Decimal>();
  for (const reservation of reservations) {
    const key = `${reservation.inventoryItemId}:${reservation.locationId}`;
    const remaining = reservation.quantity.minus(reservation.fulfilledQuantity);
    reservedByKey.set(key, (reservedByKey.get(key) ?? ZERO).plus(remaining));
  }

  const keys = new Set([
    ...movements.map((row) => `${row.inventoryItemId}:${row.locationId}`),
    ...reservedByKey.keys(),
  ]);

  for (const key of keys) {
    const [inventoryItemId, locationId] = key.split(":") as [string, string];
    const warehouseId = warehouseByLocation.get(locationId);
    if (!warehouseId) continue;

    const onHand =
      movements.find(
        (row) => row.inventoryItemId === inventoryItemId && row.locationId === locationId,
      )?._sum.signedQuantity ?? ZERO;
    const reserved = reservedByKey.get(key) ?? ZERO;

    await prisma.inventoryBalance.upsert({
      where: { inventoryItemId_locationId: { inventoryItemId, locationId } },
      update: {
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: onHand.minus(reserved),
      },
      create: {
        companyId,
        inventoryItemId,
        warehouseId,
        locationId,
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: onHand.minus(reserved),
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Company B isolation (PRD #20 §298)                                          */
/* -------------------------------------------------------------------------- */

/**
 * One warehouse, item and movement belonging to the other company, so isolation
 * can be tested rather than assumed. The SKU and warehouse code deliberately
 * repeat Company A's, proving per-company uniqueness (PRD #20 §27, §51).
 */
async function seedCompanyBInventory(prisma: PrismaClient) {
  const ownerB = "member_owner_b";

  await prisma.warehouse.upsert({
    where: { id: "wh_b_central" },
    update: {},
    create: {
      id: "wh_b_central", companyId: COMPANY_B, code: "WH-CEN",
      name: "Company B store. Must never appear in a Company A result.",
      warehouseType: "CENTRAL", city: "Munich", country: "Germany",
      status: "ACTIVE", createdByMemberId: ownerB,
    },
  });

  await prisma.inventoryLocation.upsert({
    where: { id: "loc_b_main" },
    update: {},
    create: {
      id: "loc_b_main", companyId: COMPANY_B, warehouseId: "wh_b_central",
      code: "MAIN", name: "Main area", isDefault: true, status: "ACTIVE",
      createdByMemberId: ownerB,
    },
  });

  await prisma.inventoryItem.upsert({
    where: { id: "item_b_001" },
    update: {},
    create: {
      id: "item_b_001", companyId: COMPANY_B, sku: "MAT-001",
      name: "Company B item. Must never appear in a Company A result.",
      category: "MATERIAL", baseUnit: "bag", status: "ACTIVE",
      minimumStock: qty(10), reorderPoint: qty(20),
      createdByMemberId: ownerB,
    },
  });

  await prisma.stockMovement.upsert({
    where: { id: "mv_b_001" },
    update: {},
    create: {
      id: "mv_b_001", companyId: COMPANY_B, inventoryItemId: "item_b_001",
      warehouseId: "wh_b_central", locationId: "loc_b_main",
      movementType: "ADJUSTMENT_IN", quantity: qty(250), signedQuantity: qty(250),
      unit: "bag", sourceModule: "inventory", sourceEntityType: "stock_adjustment",
      sourceEntityId: "adj_b_opening", occurredAt: daysFromNow(-60),
      postedByMemberId: ownerB,
    },
  });
}
