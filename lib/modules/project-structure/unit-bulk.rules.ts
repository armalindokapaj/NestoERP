import type { UnitCommercialStatusKey } from "./structure.types";

/**
 * Ticking units and changing them together (2026-11-09, "Tick and edit").
 * Client-safe: the shapes a selection and a change to many units answer with,
 * and the selection's own rules, pure so they are tested without a browser.
 *
 * A change to many units is each unit's own change, made by the same service
 * the unit's page uses and checked the same way — its permission, its project,
 * its company, the version the person saw. A unit that cannot take it is
 * skipped and named with the reason; the others go ahead.
 */

/** The changes ticked units can take together. */
export const UNIT_BULK_ACTIONS = ["details", "price", "status", "move", "archive"] as const;
export type UnitBulkAction = (typeof UNIT_BULK_ACTIONS)[number];

/**
 * What the selection keeps of a ticked unit: enough to send a change and to
 * say what it will do. `version` is the unit's own (details, move, archive);
 * `salesVersion` its sales record's (price, sale status), 0 before it has one.
 */
export type SelectedUnit = {
  id: string;
  label: string;
  floorId: string;
  version: number;
  salesVersion: number;
  status: UnitCommercialStatusKey;
  priced: boolean;
  archived: boolean;
};

/** Every unit a list's filters match, for "Select all N matching": at most `limit`, `total` matched. */
export type UnitSelectionDTO = { units: SelectedUnit[]; total: number; limit: number };

/**
 * Why a ticked unit was left as it was. `changed`: someone else saved it since
 * it was ticked; `already`: it is already that way; `wrong_status`: its sale
 * status does not allow the change; `on_sale`: Sales still offers, holds,
 * reserved or sold it, so it cannot be archived.
 */
export const BULK_SKIP_REASONS = ["not_found", "not_allowed", "changed", "sold", "reserved", "on_hold", "no_area", "not_sellable", "on_sale", "already", "wrong_status", "invalid", "failed"] as const;
export type BulkSkipReason = (typeof BULK_SKIP_REASONS)[number];

export type BulkSkip = { id: string; label: string | null; reason: BulkSkipReason; message: string };
/** A unit the change was made to, with the versions it has now, so the selection can carry on. */
export type BulkUpdated = { id: string; label: string; version: number; salesVersion: number; status: UnitCommercialStatusKey; priced: boolean };

/**
 * What a change to many units did: the units changed and the units skipped,
 * in the order they were sent. A price saved with "Also put it on sale" also
 * says which priced units went on sale, and which stayed back and why.
 */
export type BulkOutcome = {
  updated: BulkUpdated[];
  skipped: BulkSkip[];
  putOnSale?: { moved: string[]; skipped: BulkSkip[] };
};

/* The selection ----------------------------------------------------------- */

export type Selection = ReadonlyMap<string, SelectedUnit>;

/** Ticks a unit, or unticks it when it is ticked. */
export function toggleUnit(selection: Selection, unit: SelectedUnit): Selection {
  const next = new Map(selection);
  if (next.has(unit.id)) next.delete(unit.id);
  else next.set(unit.id, unit);
  return next;
}

/** Ticks every unit given (`on`), or unticks them; the rest of the selection stays. */
export function setUnits(selection: Selection, units: readonly SelectedUnit[], on: boolean): Selection {
  const next = new Map(selection);
  for (const unit of units) {
    if (on) next.set(unit.id, unit);
    else next.delete(unit.id);
  }
  return next;
}

/** The header tick: all of the page ticked, some, or none. */
export function pageState(selection: Selection, pageIds: readonly string[]): "all" | "some" | "none" {
  const ticked = pageIds.filter((id) => selection.has(id)).length;
  if (ticked === 0) return "none";
  return ticked === pageIds.length ? "all" : "some";
}

/**
 * The selection after the list has been read again or a change answered:
 * a ticked unit takes the versions and status it has now, so the next change
 * is checked against what is saved and not against what was ticked.
 */
export function refreshUnits(selection: Selection, fresh: ReadonlyArray<Partial<SelectedUnit> & { id: string }>): Selection {
  let next: Map<string, SelectedUnit> | null = null;
  for (const unit of fresh) {
    const current = (next ?? selection).get(unit.id);
    if (!current) continue;
    const merged = { ...current, ...Object.fromEntries(Object.entries(unit).filter(([, value]) => value !== undefined)) } as SelectedUnit;
    if (JSON.stringify(merged) === JSON.stringify(current)) continue;
    next ??= new Map(selection);
    next.set(unit.id, merged);
  }
  return next ?? selection;
}

/** The body a change sends for its units: each unit's id and the version the change is checked against. */
export function unitRefs(units: Iterable<SelectedUnit>, action: UnitBulkAction): Array<{ id: string; version: number }> {
  const sales = action === "price" || action === "status";
  return [...units].map((unit) => ({ id: unit.id, version: sales ? unit.salesVersion : unit.version }));
}

/* What a sale-status change does to a unit -------------------------------- */

export type SaleStatusChange = "put_on_sale" | "take_off_sale";

/**
 * Whether a unit can take a sale-status change, by the commercial machine
 * (`unit_commercial`): only a unit not for sale goes on sale, only one for
 * sale comes off it. Null when it can; otherwise why not. Whether the unit is
 * in use and published is the server's check.
 */
export function saleStatusSkip(change: SaleStatusChange, status: UnitCommercialStatusKey): BulkSkipReason | null {
  const from = change === "put_on_sale" ? "NOT_FOR_SALE" : "FOR_SALE";
  if (status === from) return null;
  if (status === "SOLD") return "sold";
  if (status === "RESERVED") return "reserved";
  if (status === "ON_HOLD") return "on_hold";
  return "already";
}

/** How many of the ticked units a sale-status change would move. */
export function saleStatusCount(change: SaleStatusChange, units: Iterable<SelectedUnit>): number {
  let count = 0;
  for (const unit of units) if (saleStatusSkip(change, unit.status) === null && !(change === "put_on_sale" && unit.archived)) count += 1;
  return count;
}

/** Whether saving a price may also put the unit on sale: it is not for sale (or has no sales record) and is in use. */
export function goesOnSaleWithPrice(unit: Pick<SelectedUnit, "status" | "archived">): boolean {
  return unit.status === "NOT_FOR_SALE" && !unit.archived;
}

/* Outcomes ------------------------------------------------------------------ */

/** The selection after a change: the changed units carry their new versions; the skipped stay as they were. */
export function afterChange(selection: Selection, outcome: BulkOutcome): Selection {
  return refreshUnits(selection, outcome.updated);
}
