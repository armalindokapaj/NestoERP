import type { SheetApplyInput } from "@/lib/modules/unit-sheet/unit-sheet.schema";
import type { SheetPreviewDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";

/**
 * What the person has chosen in a Sync now preview (2026-11-10), and the
 * confirm it sends. Pure and client-safe, so it is unit-tested on its own.
 *
 * Every change from the sheet and every new unit starts ticked; a clash
 * starts unpicked — the person picks the sheet's value or NESTO's, and one
 * left unpicked waits for the next sync. "Also put newly priced units on
 * sale" starts ticked, as the Price dialog's does.
 */

export type ClashPick = "SHEET" | "NESTO";

export type SyncChoices = {
  /** Ticked changes (`<unitId>:<field>`) and new units (`new:<CODE>`). */
  accept: ReadonlySet<string>;
  clashes: ReadonlyMap<string, ClashPick>;
  putOnSale: boolean;
};

export function initialChoices(preview: SheetPreviewDTO): SyncChoices {
  const accept = new Set<string>();
  for (const unit of preview.changes) for (const field of unit.fields) accept.add(field.id);
  for (const unit of preview.newUnits) accept.add(unit.id);
  return { accept, clashes: new Map(), putOnSale: true };
}

/** Ticks or unticks the given ids. */
export function setTicked(choices: SyncChoices, ids: readonly string[], on: boolean): SyncChoices {
  const accept = new Set(choices.accept);
  for (const id of ids) {
    if (on) accept.add(id);
    else accept.delete(id);
  }
  return { ...choices, accept };
}

/** Picks a side for one clash; `null` leaves it unpicked again. */
export function pickClash(choices: SyncChoices, id: string, pick: ClashPick | null): SyncChoices {
  const clashes = new Map(choices.clashes);
  if (pick) clashes.set(id, pick);
  else clashes.delete(id);
  return { ...choices, clashes };
}

/** "all", "none" or "some" of the ids are ticked: a unit's or a section's tick box. */
export function tickState(choices: SyncChoices, ids: readonly string[]): boolean | "indeterminate" {
  const ticked = ids.filter((id) => choices.accept.has(id)).length;
  if (ticked === 0) return false;
  return ticked === ids.length ? true : "indeterminate";
}

/** Every change id and new unit id of a preview, for Tick all / Untick all. */
export function allChangeIds(preview: SheetPreviewDTO): string[] {
  return preview.changes.flatMap((unit) => unit.fields.map((field) => field.id));
}

/**
 * How many things the confirm changes in NESTO: ticked changes, clashes
 * picked for the sheet's value, and ticked new units. A clash kept as NESTO
 * has it changes nothing; it is recorded all the same.
 */
export function chosenCount(preview: SheetPreviewDTO, choices: SyncChoices): number {
  let count = 0;
  for (const unit of preview.changes) for (const field of unit.fields) if (choices.accept.has(field.id)) count += 1;
  for (const unit of preview.clashes) for (const field of unit.fields) if (choices.clashes.get(field.id) === "SHEET") count += 1;
  for (const unit of preview.newUnits) if (choices.accept.has(unit.id)) count += 1;
  return count;
}

/** Clashes nobody picked a side for: left for the next sync. */
export function unpickedCount(preview: SheetPreviewDTO, choices: SyncChoices): number {
  return preview.clashes.reduce((sum, unit) => sum + unit.fields.filter((field) => !choices.clashes.has(field.id)).length, 0);
}

/**
 * Units that are not for sale and get a price from this confirm, as chosen
 * now: the ones "Also put newly priced units on sale" would move. The server
 * decides again for each unit; this is what the tick's line says.
 */
export function putOnSaleCandidates(preview: SheetPreviewDTO, choices: SyncChoices): number {
  let count = 0;
  for (const unit of preview.changes) {
    if (unit.status !== "NOT_FOR_SALE") continue;
    if (unit.fields.some((field) => field.field === "price" && field.price?.total && choices.accept.has(field.id))) count += 1;
  }
  for (const unit of preview.clashes) {
    if (unit.status !== "NOT_FOR_SALE") continue;
    if (unit.fields.some((field) => field.field === "price" && field.price?.total && choices.clashes.get(field.id) === "SHEET")) count += 1;
  }
  for (const unit of preview.newUnits) if (unit.price?.total && choices.accept.has(unit.id)) count += 1;
  return count;
}

/**
 * The confirm: what the preview read, the versions it saw of every unit with
 * a ticked change or a picked clash — so a unit changed since is skipped, not
 * overwritten — the ticked ids, each picked clash, and the on-sale tick.
 */
export function applyBody(preview: SheetPreviewDTO, choices: SyncChoices): SheetApplyInput {
  const units = new Map<string, { id: string; version: number; salesVersion: number }>();
  const accept: string[] = [];
  const clashes: Record<string, ClashPick> = {};
  for (const unit of preview.changes) {
    const ticked = unit.fields.filter((field) => choices.accept.has(field.id));
    if (!ticked.length) continue;
    units.set(unit.unitId, { id: unit.unitId, version: unit.version, salesVersion: unit.salesVersion });
    accept.push(...ticked.map((field) => field.id));
  }
  for (const unit of preview.clashes) {
    const picked = unit.fields.filter((field) => choices.clashes.has(field.id));
    if (!picked.length) continue;
    units.set(unit.unitId, { id: unit.unitId, version: unit.version, salesVersion: unit.salesVersion });
    for (const field of picked) clashes[field.id] = choices.clashes.get(field.id)!;
  }
  for (const unit of preview.newUnits) if (choices.accept.has(unit.id)) accept.push(unit.id);
  return { sheetHash: preview.sheetHash, linkVersion: preview.linkVersion, units: [...units.values()], accept, clashes, putOnSale: choices.putOnSale };
}

/** Whether the preview has anything at all to decide: changes, clashes or new units. */
export function hasDecisions(preview: SheetPreviewDTO): boolean {
  return preview.changes.length > 0 || preview.clashes.length > 0 || preview.newUnits.length > 0;
}

/**
 * The query Export sends (2026-11-10): the tab's own address — its search,
 * filters and sort, as the tab keeps them there — without the page, the open
 * unit or a one-off tick, and with the tab named. The Units tab names its
 * building and floor `building` and `floor` in its address; the list reads
 * them as `buildingId` and `floorId`.
 */
export function exportQuery(search: string, view: "units" | "sales"): string {
  const params = new URLSearchParams(search);
  for (const key of ["page", "limit", "unit", "tick", "select", "missing", "view"]) params.delete(key);
  if (view === "units") {
    const floor = params.get("floor");
    const building = params.get("building");
    params.delete("floor");
    params.delete("building");
    if (floor) params.set("floorId", floor);
    else if (building) params.set("buildingId", building);
  }
  params.set("view", view);
  return params.toString();
}

/** The file name a download answered with: `filename*` (UTF-8) first, then `filename`. */
export function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]!.trim());
    } catch {
      // Fall back to the plain name.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
  return plain?.[1] || null;
}
