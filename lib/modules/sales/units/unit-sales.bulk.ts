import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { BULK_CONCURRENCY, BulkSkipError, loadBulkTargets, runForEachUnit, skipFor, skipReasonOf, type BulkTarget } from "@/lib/modules/project-structure/unit-bulk.service";
import { saleStatusSkip, type BulkOutcome, type BulkSkip } from "@/lib/modules/project-structure/unit-bulk.rules";
import type { UnitBulkInput } from "@/lib/modules/project-structure/unit-bulk.schema";
import type { UnitCommercialStatusKey } from "@/lib/modules/project-structure/structure.types";
import { bulkAskingPrice } from "./unit-pricing.rules";
import { salesCapabilities } from "./unit-sales.core";
import { sellability } from "./unit-sales.rules";
import { changeSaleStatus, updateCommercialDetails } from "./unit-sales.service";

/**
 * Pricing ticked units, and putting them on sale or taking them off it
 * (2026-11-09). Each unit goes through the service its own Sales section uses,
 * so a sold unit's price stays frozen, a status moves only by the commercial
 * machine, and every price keeps its history — one unit at a time, each in its
 * own transaction (`runForEachUnit`).
 *
 * "Also put it on sale" saves the price first and then the status, as two of
 * the unit's own changes: a unit that cannot go on sale keeps its new price
 * and is named with the reason it stayed back.
 */

type SalesBulkInput = Extract<UnitBulkInput, { action: "price" | "status" }>;

const sellable = (target: BulkTarget) => sellability({ isActive: target.isActive, publicationStatus: target.publicationStatus }).sellable;

export async function runSalesBulk(context: UserContext, projectId: string, input: SalesBulkInput): Promise<BulkOutcome> {
  const { targets } = await loadBulkTargets(context, projectId, input.units);
  if (!salesCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");
  if (input.action === "price") assertPermission(context, "project.unit.price.manage");
  if (input.action === "status" || (input.action === "price" && input.putOnSale)) assertPermission(context, "project.unit.sales_status.manage");
  // The version a sales change is checked against; 0 is a unit with no sales record yet, as on its own page.
  const expected = (version: number) => (version > 0 ? version : undefined);

  if (input.action === "status") {
    const change = input.change;
    return runForEachUnit(
      input.units,
      targets,
      async (target, ref) => {
        const skip = saleStatusSkip(change, target.status);
        if (skip) throw new BulkSkipError(skip, skipFor(target, skip).message);
        const moved = await changeSaleStatus(context, target.id, { action: change, reason: null, expectedVersion: expected(ref.version) });
        return { version: target.version, salesVersion: moved.version, status: moved.status, priced: target.askingPrice !== null };
      },
      { concurrency: BULK_CONCURRENCY, operation: "sales.units.bulk_status" },
    );
  }

  const { entry, amount, reason, putOnSale } = input;
  const moved: string[] = [];
  const stayed: BulkSkip[] = [];
  const outcome = await runForEachUnit(
    input.units,
    targets,
    async (target, ref) => {
      if (target.status === "SOLD") throw new BulkSkipError("sold", "A sold unit's asking price does not change. Reopen the sale first.");
      const price = bulkAskingPrice(entry, amount, { saleableArea: target.saleableArea, grossArea: target.grossArea });
      if (!price) throw new BulkSkipError("no_area", skipFor(target, "no_area").message);
      // The unit keeps its sales notes and its currency (the company's base currency on a first price).
      const saved = await updateCommercialDetails(context, target.id, { ...price, reason, expectedVersion: expected(ref.version) });
      let salesVersion = saved.version;
      let status: UnitCommercialStatusKey = target.status;
      if (putOnSale && target.status === "NOT_FOR_SALE") {
        if (!sellable(target)) {
          stayed.push(skipFor(target, "not_sellable"));
        } else {
          try {
            const offered = await changeSaleStatus(context, target.id, { action: "put_on_sale", reason: null, expectedVersion: saved.version });
            salesVersion = offered.version;
            status = offered.status;
            moved.push(target.id);
          } catch (error) {
            const { reason: why, message } = skipReasonOf(error);
            stayed.push(skipFor(target, why, message));
          }
        }
      }
      return { version: target.version, salesVersion, status, priced: true };
    },
    { concurrency: BULK_CONCURRENCY, operation: "sales.units.bulk_price" },
  );
  if (!putOnSale) return outcome;
  // In the order the units were sent, whichever finished first.
  const order = new Map(input.units.map((unit, index) => [unit.id, index]));
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  return { ...outcome, putOnSale: { moved: moved.sort(byOrder), skipped: stayed.sort((a, b) => byOrder(a.id, b.id)) } };
}
