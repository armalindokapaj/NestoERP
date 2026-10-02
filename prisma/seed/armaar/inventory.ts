/**
 * Stock at Tirana Lake and The Courtyard (D-02 §39, §68, §77).
 *
 * ARMAAR had no inventory. D-02 gives BUILDING CONSTRUCTION INVEST a central
 * store in Tirana and Tirana Lake's site store, and ARLIS - NDERTIM The
 * Courtyard's store, holding §39's materials: cement, rebar, cable, façade
 * profiles, glass, tiles, PPE, sealants, fasteners, pipes, and the podium's
 * waterproofing membrane.
 *
 * As with the five-company demo, **the ledger and the balances agree**: every
 * quantity is a posted document's line with its movement — the opening
 * balance, transfers from the central store to site, receipts from the goods
 * receipts Procurement recorded (the rebar, the membrane, the Courtyard's
 * cement and PPE, each with the integration link the product writes), issues
 * to the project, a stock count — and the balances are then computed from the
 * movements exactly as the balance service does (PRD #20 §79-§83). Sealant,
 * fasteners and PPE end at or below their reorder point across the company's
 * stores, as the low-stock screen reads it; an issue of pipes is still a draft.
 *
 * Numbers in the product's shape (ISS-2026-0003). Every value is synthetic.
 * Stable ids; a rerun adds nothing.
 */
import { Prisma, type InventoryItemCategory, type PrismaClient, type StockAdjustmentReason, type StockMovementType } from "@prisma/client";

import { buildIdempotencyKey, IntegrationType } from "../../../lib/core/integrations/integration.registry";
import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { rebuildBalances } from "../inventory";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const ALN = "ARLIS_NDERTIM" as const;
const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));

const WAREHOUSES: Array<{ id: string; company: CompanyCode; code: string; name: string; type: "CENTRAL" | "PROJECT_SITE"; project?: "TIRANA_LAKE"; locations: string[] }> = [
  { id: "armaar_wh_bci_central", company: BCI, code: "WH-01", name: "Central store — Tirana", type: "CENTRAL", locations: ["MAIN", "YARD"] },
  { id: "armaar_wh_bci_tl", company: BCI, code: "WH-TL", name: "Tirana Lake — site store", type: "PROJECT_SITE", project: "TIRANA_LAKE", locations: ["MAIN", "YARD", "CONT-2"] },
];
const loc = (warehouse: string, code: string) => `${warehouse}_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

const ITEMS: Array<{ key: string; company: CompanyCode; sku: string; name: string; category: InventoryItemCategory; unit: string; minimum?: number; reorder?: number }> = [
  { key: "cement", company: BCI, sku: "CEM-425", name: "Cement CEM II/A-M 42.5", category: "MATERIAL", unit: "t", minimum: 10, reorder: 20 },
  { key: "rebar", company: BCI, sku: "REB-B500C", name: "Reinforcing steel B500C, 12–32 mm", category: "MATERIAL", unit: "t", minimum: 20, reorder: 40 },
  { key: "cable", company: BCI, sku: "CAB-5G10", name: "Power cable 5G10 mm²", category: "MATERIAL", unit: "m", minimum: 300, reorder: 600 },
  { key: "profile", company: BCI, sku: "FAC-PRF-60", name: "Façade aluminium profile, 60 mm system", category: "MATERIAL", unit: "m", minimum: 100, reorder: 200 },
  { key: "glass", company: BCI, sku: "GLS-IGU", name: "Insulated glass units, triple, 6/16/6/16/6", category: "MATERIAL", unit: "m²", minimum: 40, reorder: 80 },
  { key: "tiles", company: BCI, sku: "TIL-6060", name: "Porcelain tile 60×60, rectified", category: "MATERIAL", unit: "m²", minimum: 100, reorder: 200 },
  { key: "ppe", company: BCI, sku: "PPE-KIT", name: "PPE kit — hard hat, harness, gloves, hi-vis", category: "CONSUMABLE", unit: "set", minimum: 40, reorder: 80 },
  { key: "sealant", company: BCI, sku: "SEA-SIL", name: "Silicone sealant, neutral cure", category: "CONSUMABLE", unit: "tube", minimum: 30, reorder: 60 },
  { key: "fasteners", company: BCI, sku: "FAS-M12", name: "Anchor bolts M12 × 120, box of 50", category: "CONSUMABLE", unit: "box", minimum: 10, reorder: 20 },
  { key: "pipe", company: BCI, sku: "PIP-PPR32", name: "PPR pipe 32 mm", category: "MATERIAL", unit: "m", minimum: 200, reorder: 400 },
  { key: "membrane", company: BCI, sku: "WPM-SBS", name: "Waterproofing membrane, SBS, two-layer system", category: "MATERIAL", unit: "m²", minimum: 100, reorder: 150 },
];
const itemId = (company: CompanyCode, key: string) => `armaar_item_${company === BCI ? "bci" : "aln"}_${key}`;
const unitOf = (company: CompanyCode, key: string) => ITEMS.find((item) => item.company === company && item.key === key)!.unit;

type Line = { item: string; location: string; quantity: number };
type Doc =
  | { kind: "adjustment"; id: string; company: CompanyCode; number: string; warehouse: string; day: number; reason: StockAdjustmentReason; notes: string; lines: Line[] }
  | { kind: "receipt"; id: string; company: CompanyCode; number: string; warehouse: string; day: number; goodsReceipt: string; lines: Line[] }
  | { kind: "issue"; id: string; company: CompanyCode; number: string; warehouse: string; day: number; project: "TIRANA_LAKE"; to: string; posted: boolean; notes: string; lines: Line[] }
  | { kind: "transfer"; id: string; company: CompanyCode; number: string; from: string; to: string; day: number; lines: Array<{ item: string; from: string; to: string; quantity: number }> };

const C = "armaar_wh_bci_central";
const T = "armaar_wh_bci_tl";

const DOCS: Doc[] = [
  { kind: "adjustment", id: "armaar_adj_bci_0001", company: BCI, number: "ADJ-2026-0001", warehouse: C, day: -150, reason: "OPENING_BALANCE", notes: "Opening stock when the central store went live in NESTO.", lines: [
    { item: "cement", location: loc(C, "YARD"), quantity: 120 }, { item: "cable", location: loc(C, "MAIN"), quantity: 4_000 }, { item: "profile", location: loc(C, "YARD"), quantity: 1_800 },
    { item: "glass", location: loc(C, "MAIN"), quantity: 600 }, { item: "tiles", location: loc(C, "MAIN"), quantity: 900 }, { item: "ppe", location: loc(C, "MAIN"), quantity: 140 },
    { item: "sealant", location: loc(C, "MAIN"), quantity: 270 }, { item: "fasteners", location: loc(C, "MAIN"), quantity: 105 }, { item: "pipe", location: loc(C, "YARD"), quantity: 2_500 },
  ] },
  { kind: "receipt", id: "armaar_ir_bci_0001", company: BCI, number: "GRN-2026-0001", warehouse: T, day: -52, goodsReceipt: "armaar_grn_tl_membrane_0068", lines: [{ item: "membrane", location: loc(T, "YARD"), quantity: 3_100 }] },
  { kind: "issue", id: "armaar_iss_bci_0001", company: BCI, number: "ISS-2026-0001", warehouse: T, day: -45, project: "TIRANA_LAKE", to: "arlis.site-supervisor", posted: true, notes: "Podium roof, zones 1 to 3.", lines: [{ item: "membrane", location: loc(T, "YARD"), quantity: 2_900 }] },
  { kind: "transfer", id: "armaar_trf_bci_0001", company: BCI, number: "TRF-2026-0001", from: C, to: T, day: -40, lines: [
    { item: "cement", from: loc(C, "YARD"), to: loc(T, "YARD"), quantity: 80 }, { item: "cable", from: loc(C, "MAIN"), to: loc(T, "MAIN"), quantity: 2_500 },
    { item: "ppe", from: loc(C, "MAIN"), to: loc(T, "CONT-2"), quantity: 120 }, { item: "fasteners", from: loc(C, "MAIN"), to: loc(T, "CONT-2"), quantity: 100 },
    { item: "sealant", from: loc(C, "MAIN"), to: loc(T, "CONT-2"), quantity: 250 },
  ] },
  { kind: "receipt", id: "armaar_ir_bci_0002", company: BCI, number: "GRN-2026-0002", warehouse: T, day: -20, goodsReceipt: "armaar_grn_tl_001", lines: [{ item: "rebar", location: loc(T, "YARD"), quantity: 243 }] },
  { kind: "transfer", id: "armaar_trf_bci_0002", company: BCI, number: "TRF-2026-0002", from: C, to: T, day: -18, lines: [
    { item: "profile", from: loc(C, "YARD"), to: loc(T, "YARD"), quantity: 1_200 }, { item: "glass", from: loc(C, "MAIN"), to: loc(T, "MAIN"), quantity: 400 },
    { item: "pipe", from: loc(C, "YARD"), to: loc(T, "YARD"), quantity: 1_600 },
  ] },
  { kind: "issue", id: "armaar_iss_bci_0002", company: BCI, number: "ISS-2026-0002", warehouse: T, day: -15, project: "TIRANA_LAKE", to: "arlis.site-supervisor", posted: true, notes: "Tower A, levels 11 and 12.", lines: [{ item: "rebar", location: loc(T, "YARD"), quantity: 180 }] },
  { kind: "issue", id: "armaar_iss_bci_0003", company: BCI, number: "ISS-2026-0003", warehouse: T, day: -10, project: "TIRANA_LAKE", to: "arlis.site-engineer", posted: true, notes: "Blockwork mortar, Tower A levels 5 to 8.", lines: [{ item: "cement", location: loc(T, "YARD"), quantity: 55 }] },
  { kind: "issue", id: "armaar_iss_bci_0004", company: BCI, number: "ISS-2026-0004", warehouse: T, day: -8, project: "TIRANA_LAKE", to: "arlis.mep", posted: true, notes: "Tower A first fix, levels 5 to 8; PPE for the new electricians.", lines: [{ item: "cable", location: loc(T, "MAIN"), quantity: 1_400 }, { item: "ppe", location: loc(T, "CONT-2"), quantity: 60 }] },
  { kind: "issue", id: "armaar_iss_bci_0005", company: BCI, number: "ISS-2026-0005", warehouse: T, day: -5, project: "TIRANA_LAKE", to: "arlis.site-supervisor", posted: true, notes: "Tower B façade brackets and joints.", lines: [{ item: "fasteners", location: loc(T, "CONT-2"), quantity: 85 }, { item: "sealant", location: loc(T, "CONT-2"), quantity: 230 }] },
  { kind: "issue", id: "armaar_iss_bci_0006", company: BCI, number: "ISS-2026-0006", warehouse: T, day: -3, project: "TIRANA_LAKE", to: "arlis.site-supervisor", posted: true, notes: "Tower B curtain wall, levels 4 to 6.", lines: [{ item: "profile", location: loc(T, "YARD"), quantity: 900 }, { item: "glass", location: loc(T, "MAIN"), quantity: 300 }] },
  { kind: "adjustment", id: "armaar_adj_bci_0002", company: BCI, number: "ADJ-2026-0002", warehouse: T, day: -2, reason: "PHYSICAL_COUNT", notes: "Monthly count: two tonnes of cement hardened in split bags.", lines: [{ item: "cement", location: loc(T, "YARD"), quantity: -2 }] },
  { kind: "issue", id: "armaar_iss_bci_0007", company: BCI, number: "ISS-2026-0007", warehouse: T, day: 0, project: "TIRANA_LAKE", to: "arlis.mep", posted: false, notes: "Tower B risers — waiting for the plumbers to collect.", lines: [{ item: "pipe", location: loc(T, "YARD"), quantity: 400 }] },
];

const SIGN: Record<StockMovementType, 1 | -1> = { RECEIPT: 1, RETURN_TO_STOCK: 1, TRANSFER_IN: 1, ADJUSTMENT_IN: 1, ISSUE: -1, TRANSFER_OUT: -1, ADJUSTMENT_OUT: -1, REVERSAL: 1 };

export async function seedArmaarInventory(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const keeper = (code: CompanyCode) => memberId("arlis.inventory", code);

  for (const warehouse of WAREHOUSES) {
    await prisma.warehouse.upsert({
      where: { id: warehouse.id },
      update: {},
      create: { id: warehouse.id, companyId: companyId(warehouse.company), code: warehouse.code, name: warehouse.name, warehouseType: warehouse.type, projectId: warehouse.project ? projectId(warehouse.project) : null, city: "Tirana", country: "Albania", status: "ACTIVE", createdByMemberId: keeper(warehouse.company), createdAt: at(-160) },
    });
    for (const [index, code] of warehouse.locations.entries()) {
      await prisma.inventoryLocation.upsert({
        where: { id: loc(warehouse.id, code) },
        update: {},
        create: { id: loc(warehouse.id, code), companyId: companyId(warehouse.company), warehouseId: warehouse.id, code, name: code === "MAIN" ? "Main store" : code === "YARD" ? "Yard" : "Container 2", status: "ACTIVE", isDefault: index === 0, createdByMemberId: keeper(warehouse.company) },
      });
    }
  }
  for (const item of ITEMS) {
    const home = T;
    await prisma.inventoryItem.upsert({
      where: { id: itemId(item.company, item.key) },
      update: {},
      create: { id: itemId(item.company, item.key), companyId: companyId(item.company), sku: item.sku, name: item.name, category: item.category, baseUnit: item.unit, status: "ACTIVE", minimumStock: item.minimum === undefined ? null : qty(item.minimum), reorderPoint: item.reorder === undefined ? null : qty(item.reorder), defaultWarehouseId: home, defaultLocationId: loc(home, "MAIN"), createdByMemberId: keeper(item.company), createdAt: at(-160) },
    });
  }

  /* Documents, each posted line with its movement ----------------------------- */
  for (const doc of DOCS) {
    const code = doc.company;
    const company = companyId(code);
    const by = keeper(code);
    const when = at(doc.day, 11);
    const movement = async (input: { id: string; item: string; warehouse: string; location: string; type: StockMovementType; quantity: number; project?: string | null; lineId: string; entityType: string }) => {
      const amount = qty(Math.abs(input.quantity));
      await prisma.stockMovement.upsert({
        where: { id: input.id },
        // Converges on a re-run, as the five-company demo's ledger does: a corrected quantity takes effect.
        update: { quantity: amount, signedQuantity: amount.mul(SIGN[input.type]) },
        create: { id: input.id, companyId: company, inventoryItemId: itemId(code, input.item), warehouseId: input.warehouse, locationId: input.location, movementType: input.type, quantity: amount, signedQuantity: amount.mul(SIGN[input.type]), unit: unitOf(code, input.item), projectId: input.project ?? null, sourceModule: "inventory", sourceEntityType: input.entityType, sourceEntityId: doc.id, sourceLineId: input.lineId, occurredAt: when, postedByMemberId: by, createdAt: when },
      });
      return input.id;
    };

    if (doc.kind === "adjustment") {
      await prisma.stockAdjustment.upsert({ where: { id: doc.id }, update: {}, create: { id: doc.id, companyId: company, adjustmentNumber: doc.number, warehouseId: doc.warehouse, adjustmentDate: day(doc.day), reason: doc.reason, status: "POSTED", notes: doc.notes, createdByMemberId: by, postedByMemberId: by, createdAt: when } });
      for (const [index, line] of doc.lines.entries()) {
        const lineId = `${doc.id}_line_${index + 1}`;
        const moved = await movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: line.quantity >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: line.quantity, lineId, entityType: "stock_adjustment" });
        await prisma.stockAdjustmentLine.upsert({ where: { id: lineId }, update: {}, create: { id: lineId, stockAdjustmentId: doc.id, inventoryItemId: itemId(code, line.item), locationId: line.location, quantityDelta: qty(line.quantity), unit: unitOf(code, line.item), movementId: moved } });
      }
    } else if (doc.kind === "receipt") {
      await prisma.inventoryReceipt.upsert({ where: { id: doc.id }, update: {}, create: { id: doc.id, companyId: company, receiptNumber: doc.number, goodsReceiptId: doc.goodsReceipt, warehouseId: doc.warehouse, status: "POSTED", receiptDate: day(doc.day), postedAt: when, createdByMemberId: by, postedByMemberId: by, notes: "Received into stock from the goods receipt.", createdAt: when } });
      for (const [index, line] of doc.lines.entries()) {
        const lineId = `${doc.id}_line_${index + 1}`;
        const moved = await movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: "RECEIPT", quantity: line.quantity, lineId, entityType: "inventory_receipt" });
        await prisma.inventoryReceiptLine.upsert({ where: { id: lineId }, update: {}, create: { id: lineId, inventoryReceiptId: doc.id, goodsReceiptItemId: `${doc.goodsReceipt}_item_1`, inventoryItemId: itemId(code, line.item), locationId: line.location, quantity: qty(line.quantity), unit: unitOf(code, line.item), movementId: moved } });
      }
      // Receiving a goods receipt into stock is the product's CREATE_FROM handoff; its trace (PRD #23).
      const type = IntegrationType.PROCUREMENT_RECEIPT_INVENTORY_RECEIPT;
      const idempotencyKey = buildIdempotencyKey(company, type, doc.goodsReceipt);
      await prisma.integrationLink.upsert({
        where: { companyId_integrationType_idempotencyKey: { companyId: company, integrationType: type, idempotencyKey } },
        update: {},
        create: { companyId: company, integrationType: type, mode: "CREATE_FROM", sourceModule: "procurement", sourceEntityType: "goods_receipt", sourceEntityId: doc.goodsReceipt, targetModule: "inventory", targetEntityType: "inventory_receipt", targetEntityId: doc.id, idempotencyKey, createdByMemberId: by, createdAt: when },
      });
    } else if (doc.kind === "issue") {
      const project = projectId(doc.project);
      await prisma.stockIssue.upsert({ where: { id: doc.id }, update: {}, create: { id: doc.id, companyId: company, issueNumber: doc.number, projectId: project, warehouseId: doc.warehouse, status: doc.posted ? "POSTED" : "DRAFT", issueDate: day(doc.day), issuedToMemberId: memberId(doc.to, code), requestedByMemberId: memberId(doc.to, code), createdByMemberId: by, postedByMemberId: doc.posted ? by : null, notes: doc.notes, createdAt: when } });
      for (const [index, line] of doc.lines.entries()) {
        const lineId = `${doc.id}_line_${index + 1}`;
        const moved = doc.posted ? await movement({ id: `${doc.id}_mv_${index + 1}`, item: line.item, warehouse: doc.warehouse, location: line.location, type: "ISSUE", quantity: line.quantity, project, lineId, entityType: "stock_issue" }) : null;
        await prisma.stockIssueLine.upsert({ where: { id: lineId }, update: {}, create: { id: lineId, stockIssueId: doc.id, inventoryItemId: itemId(code, line.item), locationId: line.location, quantity: qty(line.quantity), unit: unitOf(code, line.item), movementId: moved } });
      }
    } else {
      await prisma.stockTransfer.upsert({ where: { id: doc.id }, update: {}, create: { id: doc.id, companyId: company, transferNumber: doc.number, fromWarehouseId: doc.from, toWarehouseId: doc.to, transferDate: day(doc.day), status: "POSTED", createdByMemberId: by, postedByMemberId: by, notes: "Stock for the site's next weeks.", createdAt: when } });
      for (const [index, line] of doc.lines.entries()) {
        const lineId = `${doc.id}_line_${index + 1}`;
        const out = await movement({ id: `${doc.id}_out_${index + 1}`, item: line.item, warehouse: doc.from, location: line.from, type: "TRANSFER_OUT", quantity: line.quantity, lineId, entityType: "stock_transfer" });
        const into = await movement({ id: `${doc.id}_in_${index + 1}`, item: line.item, warehouse: doc.to, location: line.to, type: "TRANSFER_IN", quantity: line.quantity, lineId, entityType: "stock_transfer" });
        await prisma.stockTransferLine.upsert({ where: { id: lineId }, update: {}, create: { id: lineId, stockTransferId: doc.id, inventoryItemId: itemId(code, line.item), fromLocationId: line.from, toLocationId: line.to, quantity: qty(line.quantity), unit: unitOf(code, line.item), outMovementId: out, inMovementId: into } });
      }
    }
  }

  // Balances are the ledger's sum, as the balance service computes them (PRD #20 §79-§83).
  for (const code of [BCI] as CompanyCode[]) await rebuildBalances(prisma, companyId(code));

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    items: await prisma.inventoryItem.count({ where: inGroup }),
    warehouses: await prisma.warehouse.count({ where: inGroup }),
    movements: await prisma.stockMovement.count({ where: inGroup }),
  };
}
