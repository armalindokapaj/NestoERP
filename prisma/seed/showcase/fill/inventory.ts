/**
 * The site stores: a store on every project that buys, the stock items its
 * deliveries brought in, each delivery booked into stock, and materials issued
 * to the site week by week — with returns of what was left over, a draft issue
 * waiting to be posted, and a few items run below their reorder point.
 */
import type { InventoryItemCategory, Prisma, PrismaClient } from "@prisma/client";

import { rebuildBalances } from "../../inventory";
import type { DeliveredReceipt } from "./procurement";
import { at, businessDay, castOf, dec, Numbers, random, round2, type Clock } from "./kit";

/** Deliveries that go into a store; concrete, plant hire and labour do not. */
const NOT_STOCKED = /concrete|pump|rental|operator|erection|installation|portal frame|purlins/i;

const PLACES = ["for the slab pour on the next level", "for the basement walls", "to the formwork crew", "to the MEP subcontractor", "for the façade mock-up", "to the finishing crew on the lower floors", "for the stair cores", "to the site maintenance team"];

export async function seedShowcaseInventory(prisma: PrismaClient, clock: Clock, delivered: DeliveredReceipt[]) {
  const numbers = new Numbers(prisma);
  const totals = { warehouses: 0, items: 0, receipts: 0, issues: 0, returns: 0 };

  for (const companyId of new Set(delivered.map((row) => row.companyId))) {
    const cast = await castOf(prisma, companyId);
    const rand = random(`inventory:${companyId}`);
    const receipts = delivered.filter((row) => row.companyId === companyId);
    const move = (data: Prisma.StockMovementCreateManyInput) => prisma.stockMovement.create({ data });

    // A store on every project, with its main area, a yard and a container.
    const stores = new Map<string, { warehouseId: string; main: string; yard: string }>();
    for (const projectId of new Set(receipts.map((row) => row.projectId))) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true, city: true, address: true } });
      const warehouseId = `wh_${projectId}`;
      await prisma.warehouse.create({ data: { id: warehouseId, companyId, code: `WH-${project.code}`, name: `${project.name} site store`, description: "Lockable containers by the gate and a fenced laydown yard.", warehouseType: "PROJECT_SITE", projectId, address: project.address, city: project.city, country: "Albania", status: "ACTIVE", createdByMemberId: cast.member("inventory"), createdAt: at(clock, -400) } });
      const location = async (code: string, name: string, isDefault: boolean) => (await prisma.inventoryLocation.create({ data: { companyId, warehouseId, code, name, isDefault, status: "ACTIVE", createdByMemberId: cast.member("inventory") }, select: { id: true } })).id;
      stores.set(projectId, { warehouseId, main: await location("MAIN", "Site container", true), yard: await location("YARD", "Laydown yard", false) });
      await location("CONT-2", "Container 2 — PPE and tools", false);
      totals.warehouses += 1;
    }

    // One stock item for each material the deliveries brought.
    const items = new Map<string, { id: string; unit: string }>();
    const existing = await prisma.inventoryItem.count({ where: { companyId } });
    for (const line of receipts.flatMap((row) => row.lines).filter((row) => !NOT_STOCKED.test(row.description))) {
      if (items.has(line.description)) continue;
      const category: InventoryItemCategory = /helmet|harness|vest|gloves/i.test(line.description) ? "CONSUMABLE" : /diesel/i.test(line.description) ? "CONSUMABLE" : "MATERIAL";
      const id = `item_${companyId.slice(-1)}_${items.size + 1}`;
      await prisma.inventoryItem.create({ data: { id, companyId, sku: `${category === "MATERIAL" ? "MAT" : "CON"}-${String(existing + items.size + 101)}`, name: line.description, baseUnit: line.unit, category, status: "ACTIVE", createdByMemberId: cast.member("inventory"), createdAt: at(clock, -400) } });
      items.set(line.description, { id, unit: line.unit });
      totals.items += 1;
    }

    // Every delivery booked into its project's store.
    const received = new Map<string, number>();
    const firstIn = new Map<string, number>();
    for (const receipt of receipts) {
      const lines = receipt.lines.filter((line) => items.has(line.description) && line.quantity > 0);
      if (lines.length === 0) continue;
      const store = stores.get(receipt.projectId)!;
      const number = await numbers.take({ companyId, table: "inventory_receipts", column: "receiptNumber", prefix: "IR", year: at(clock, receipt.date).getUTCFullYear() });
      const id = `ir_${receipt.goodsReceiptId}`;
      await prisma.inventoryReceipt.create({ data: { id, companyId, receiptNumber: number, goodsReceiptId: receipt.goodsReceiptId, warehouseId: store.warehouseId, status: "POSTED", receiptDate: businessDay(clock, receipt.date), postedAt: at(clock, receipt.date, 15), createdByMemberId: cast.member("inventory"), postedByMemberId: cast.member("inventory"), notes: `Booked in from ${receipt.receiptNumber}.`, createdAt: at(clock, receipt.date, 15) } });
      for (const [index, line] of lines.entries()) {
        const item = items.get(line.description)!;
        const locationId = /block|board|membrane|plywood|timber|rebar/i.test(line.description) ? store.yard : store.main;
        const movementId = `mv_${id}_${index + 1}`;
        await move({ id: movementId, companyId, inventoryItemId: item.id, warehouseId: store.warehouseId, locationId, movementType: "RECEIPT", quantity: dec(line.quantity), signedQuantity: dec(line.quantity), unit: item.unit, projectId: receipt.projectId, sourceModule: "inventory", sourceEntityType: "inventory_receipt", sourceEntityId: id, occurredAt: at(clock, receipt.date, 15), postedByMemberId: cast.member("inventory") });
        await prisma.inventoryReceiptLine.create({ data: { id: `${id}_line_${index + 1}`, inventoryReceiptId: id, goodsReceiptItemId: line.goodsReceiptItemId, inventoryItemId: item.id, locationId, quantity: dec(line.quantity), unit: item.unit, movementId } });
        const key = `${receipt.projectId}|${item.id}|${locationId}`;
        received.set(key, round2((received.get(key) ?? 0) + line.quantity));
        firstIn.set(key, Math.min(firstIn.get(key) ?? 0, receipt.date));
      }
      totals.receipts += 1;
    }

    // Issued to the site over the following weeks; most of it used, some returned.
    const balances = new Map(received);
    for (const [key, quantity] of received) {
      const [projectId, itemId, locationId] = key.split("|") as [string, string, string];
      const store = stores.get(projectId)!;
      const item = [...items.values()].find((row) => row.id === itemId)!;
      // Most stock goes out; a few items are drawn down past their reorder point.
      const shares = rand.chance(0.25) ? [0.35, 0.3, 0.2] : [0.3, 0.25];
      for (const [index, share] of shares.entries()) {
        const amount = round2(quantity * share);
        if (amount <= 0) continue;
        // Spread from the delivery to this week, so the store is busy right up to today.
        const from = firstIn.get(key)! + 3;
        const when = index === shares.length - 1 ? -rand.int(1, 12) : Math.min(-1, Math.round(from + ((-from - 2) * (index + 1)) / (shares.length + 1)) + rand.int(-2, 2));
        const number = await numbers.take({ companyId, table: "stock_issues", column: "issueNumber", prefix: "ISS", year: at(clock, when).getUTCFullYear() });
        const id = `iss_${companyId.slice(-1)}_${number.toLowerCase().replace(/-/g, "_")}`;
        const movementId = `mv_${id}`;
        await prisma.stockIssue.create({ data: { id, companyId, issueNumber: number, projectId, warehouseId: store.warehouseId, status: "POSTED", issueDate: businessDay(clock, when), issuedToMemberId: cast.member("pm"), requestedByMemberId: cast.member("pm"), createdByMemberId: cast.member("inventory"), postedByMemberId: cast.member("inventory"), notes: `Issued ${rand.pick(PLACES)}.`, createdAt: at(clock, when, 8) } });
        await move({ id: movementId, companyId, inventoryItemId: itemId, warehouseId: store.warehouseId, locationId, movementType: "ISSUE", quantity: dec(amount), signedQuantity: dec(-amount), unit: item.unit, projectId, sourceModule: "inventory", sourceEntityType: "stock_issue", sourceEntityId: id, occurredAt: at(clock, when, 8), postedByMemberId: cast.member("inventory") });
        await prisma.stockIssueLine.create({ data: { id: `${id}_line_1`, stockIssueId: id, inventoryItemId: itemId, locationId, quantity: dec(amount), unit: item.unit, movementId } });
        balances.set(key, round2(balances.get(key)! - amount));
        totals.issues += 1;

        // Now and then the crew brings back what it did not use.
        if (index === 0 && rand.chance(0.15)) {
          const back = round2(amount * 0.12);
          const returned = when + 5;
          const returnNumber = await numbers.take({ companyId, table: "stock_returns", column: "returnNumber", prefix: "RET", year: at(clock, returned).getUTCFullYear() });
          const returnId = `ret_${companyId.slice(-1)}_${returnNumber.toLowerCase().replace(/-/g, "_")}`;
          await prisma.stockReturn.create({ data: { id: returnId, companyId, returnNumber, projectId, warehouseId: store.warehouseId, returnDate: businessDay(clock, returned), status: "POSTED", returnedByMemberId: cast.member("pm"), createdByMemberId: cast.member("inventory"), postedByMemberId: cast.member("inventory"), notes: "Left over after the pour; returned to the store.", createdAt: at(clock, returned, 16) } });
          await move({ id: `mv_${returnId}`, companyId, inventoryItemId: itemId, warehouseId: store.warehouseId, locationId, movementType: "RETURN_TO_STOCK", quantity: dec(back), signedQuantity: dec(back), unit: item.unit, projectId, sourceModule: "inventory", sourceEntityType: "stock_return", sourceEntityId: returnId, occurredAt: at(clock, returned, 16), postedByMemberId: cast.member("inventory") });
          await prisma.stockReturnLine.create({ data: { id: `${returnId}_line_1`, stockReturnId: returnId, inventoryItemId: itemId, locationId, quantity: dec(back), unit: item.unit, sourceIssueLineId: `${id}_line_1`, movementId: `mv_${returnId}` } });
          balances.set(key, round2(balances.get(key)! + back));
          totals.returns += 1;
        }
      }
    }

    // Reorder points at a quarter of what came in, so the drawn-down items show as low.
    for (const [key, quantity] of received) {
      const itemId = key.split("|")[1]!;
      await prisma.inventoryItem.update({ where: { id: itemId }, data: { reorderPoint: dec(Math.ceil(quantity * 0.25)), minimumStock: dec(Math.ceil(quantity * 0.1)) } });
    }

    // One issue drafted for tomorrow's pour, not yet posted, on each store.
    for (const [projectId, store] of stores) {
      const key = [...balances.keys()].find((row) => row.startsWith(`${projectId}|`) && balances.get(row)! > 10);
      if (!key) continue;
      const [, itemId, locationId] = key.split("|") as [string, string, string];
      const item = [...items.values()].find((row) => row.id === itemId)!;
      const number = await numbers.take({ companyId, table: "stock_issues", column: "issueNumber", prefix: "ISS", year: clock.now.getUTCFullYear() });
      const id = `iss_${companyId.slice(-1)}_${number.toLowerCase().replace(/-/g, "_")}`;
      await prisma.stockIssue.create({ data: { id, companyId, issueNumber: number, projectId, warehouseId: store.warehouseId, status: "DRAFT", issueDate: businessDay(clock, 1), issuedToMemberId: cast.member("pm"), requestedByMemberId: cast.member("pm"), createdByMemberId: cast.member("pm"), notes: "Requested for tomorrow's first shift.", createdAt: at(clock, 0, 16), lines: { create: [{ inventoryItemId: itemId, locationId, quantity: dec(round2(balances.get(key)! * 0.2)), unit: item.unit }] } } });
      totals.issues += 1;
    }

    await rebuildBalances(prisma, companyId);
  }
  return totals;
}
