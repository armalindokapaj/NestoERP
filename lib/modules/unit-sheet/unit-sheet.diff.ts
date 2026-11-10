import type { UnitTypeCategory } from "@/config/unit-types";
import { grossAreaIsTyped, structureKey, unitLabel, workedOutAreas } from "@/lib/modules/project-structure/structure.rules";
import type { CountField, UnitCommercialStatusKey } from "@/lib/modules/project-structure/structure.types";
import { priceFromRate, rateFromPrice, saleArea } from "@/lib/modules/sales/units/unit-pricing.rules";
import { IGNORED_COLUMNS, isReadOnlyColumn, mapHeaders, SHEET_HEADERS, type SheetColumn } from "./unit-sheet.columns";
import { cellText, rowIsBlank, type SheetCell, type SheetGrid } from "./unit-sheet.parse";
import { SHEET_FIELDS, type SheetCheckDTO, type SheetField, type SheetPriceDTO, type SheetSkipDTO, type SheetSkipReason, type SheetStructureField } from "./unit-sheet.types";
import { type FieldRead, matchBuilding, matchFloor, matchUnitType, nameText, readArea, readCode, readCount, readMoney, readOrientation } from "./unit-sheet.values";

/**
 * Comparing the sheet with NESTO (2026-11-10). Pure: everything it needs is
 * passed in, so every case is tested without a database or a network.
 *
 * A row is a unit by its code — "T-501", the code every screen shows, or the
 * unit's own "501", with the Building column to tell two apart — folded as
 * codes are (`structureKey`). A row whose code NESTO does not have proposes a
 * new unit.
 *
 * For each field the sheet has a column for, three values are compared: what
 * the sheet says now, what NESTO has now, and the baseline — what each of
 * them said at the last confirmed sync:
 *
 *   sheet moved, NESTO did not        → a change from the sheet, to confirm
 *   NESTO moved, the sheet did not    → newer in NESTO; the sheet is behind
 *   both moved, to different values   → a clash: the person picks one
 *   both moved to the same, or equal  → nothing to do
 *
 * With no baseline yet — the first sync, a unit new to the sheet, a column
 * added since — every difference is a change from the sheet. A column the
 * sheet does not have is a field the sheet does not manage, never an empty
 * one; an empty cell in a column it has asks for the value to be cleared.
 * Nothing is ever deleted or archived from the sheet.
 *
 * The net area, and the gross area of anything but land, are worked out by
 * NESTO on every save: their columns are read only for land's gross area.
 * The asking price comes from the Total price column or the Price per m²
 * column, whichever the sheet changed; a price per m² is on the unit's sale
 * area — saleable when typed, else gross — as it will be after this sync.
 */

/** What the sheet and NESTO said of one field at the last confirmed sync. `s`/`r` absent: the sheet had no such column then. */
export type BaselineEntry = { s?: string | null; r?: string | null; n: string | null };
export type UnitBaseline = Partial<Record<SheetField, BaselineEntry>>;

/** One unit as the comparison sees it: canonical values, `type` its type's id, `price` its asking price. */
export type DiffUnit = {
  id: string;
  unitCode: string;
  label: string;
  buildingId: string;
  floorId: string;
  category: UnitTypeCategory;
  archived: boolean;
  version: number;
  salesVersion: number;
  status: UnitCommercialStatusKey;
  currency: string | null;
  values: Record<SheetField, string | null>;
};

export type DiffBuilding = { id: string; name: string; code: string | null; floors: Array<{ id: string; name: string; number: number | null }> };
export type DiffType = { id: string; name: string; code: string; category: UnitTypeCategory; isActive: boolean };

export type DiffInput = {
  grid: SheetGrid;
  /** Every unit of the project, archived ones too, in the Units table's order. */
  units: readonly DiffUnit[];
  buildings: readonly DiffBuilding[];
  types: readonly DiffType[];
  baselines: ReadonlyMap<string, UnitBaseline>;
  can: { managePrice: boolean; createUnit: boolean };
};

/** A price the sheet asks for: the total, or a price per m² that the total is worked out from. */
export type PriceProposal = { entry: "TOTAL" | "PER_SQM"; amount: string | null; total: string | null; rate: string | null; area: string | null };

/** What the sheet said of a field this time, by column: the baseline is written from it. */
export type SheetSide = { s?: string | null; r?: string | null };

export type FieldOutcome =
  | { kind: "change"; field: SheetField; from: string | null; to: string | null; price: PriceProposal | null }
  | { kind: "clash"; field: SheetField; sheet: string | null; nesto: string | null; price: PriceProposal | null }
  | { kind: "newer"; field: SheetField; sheet: string | null; nesto: string | null }
  | { kind: "agree"; field: SheetField };

export type MatchedUnit = { unit: DiffUnit; row: number; outcomes: FieldOutcome[]; sheet: Partial<Record<SheetField, SheetSide>> };

export type NewUnitPlan = {
  id: string;
  row: number;
  unitCode: string;
  label: string;
  building: { id: string; name: string };
  floor: { id: string; name: string };
  type: DiffType;
  values: Partial<Record<Exclude<SheetStructureField, "type">, string | null>>;
  price: PriceProposal | null;
  sheet: Partial<Record<SheetField, SheetSide>>;
};

export type SheetDiff = {
  check: SheetCheckDTO;
  matched: MatchedUnit[];
  newUnits: NewUnitPlan[];
  skipped: SheetSkipDTO[];
  notInSheet: DiffUnit[];
};

/** A change's id in a preview and in the confirm that answers it. */
export const changeId = (unitId: string, field: SheetField) => `${unitId}:${field}`;
export const newUnitId = (codeKey: string) => `new:${codeKey}`;

const AREA_COLUMNS = ["internalArea", "balconyArea", "terraceArea", "commonAreaAllocation", "saleableArea", "outdoorArea", "gardenArea"] as const;
const COUNT_COLUMNS = ["bedrooms", "bathrooms", "storage"] as const satisfies readonly CountField[];

const SKIP_MESSAGES: Record<SheetSkipReason, string> = {
  no_code: "This row has no unit code.",
  invalid_code: "This unit code cannot be read.",
  ambiguous_code: "This code matches more than one unit. Add the Building column to tell them apart.",
  duplicate_row: "This unit is on more than one row of the sheet.",
  building_mismatch: "NESTO has this unit in another building. The sheet does not move units.",
  archived: "This unit is archived, so the sheet does not change it.",
  missing_building: "A new unit needs its building in the Building column.",
  unknown_building: "This project has no building by that name or code.",
  ambiguous_building: "That name matches more than one building.",
  missing_floor: "A new unit needs its floor in the Floor column.",
  unknown_floor: "That building has no floor by that name.",
  missing_type: "A new unit needs its type in the Type column.",
  unknown_type: "There is no unit type by that name.",
  retired_type: "That unit type is retired. Choose a type in use.",
  code_taken: "NESTO already has a unit with this code.",
  not_allowed_create: "You cannot add units, so this new unit was left out.",
  invalid_value: "This value cannot be read.",
  price_inconsistent: "The total price and the price per m² do not agree. Change one of them.",
  no_area: "This unit has no saleable or gross area to price per m².",
  price_not_allowed: "You cannot change prices, so this price was left out.",
  sold: "A sold unit's asking price does not change.",
  changed: "This unit changed since the preview. Sync again.",
  not_allowed: "You cannot change this unit.",
  not_found: "That unit could not be found in this project.",
  not_sellable: "This unit is archived or inactive, so it cannot be offered.",
  invalid: "This change does not fit this unit.",
  failed: "This unit could not be changed. Try again.",
};

export function sheetSkip(input: { reason: SheetSkipReason; row?: number | null; code?: string | null; unit?: { id: string; label: string } | null; field?: SheetField | null; value?: string | null; message?: string }): SheetSkipDTO {
  return {
    row: input.row ?? null,
    code: input.code ?? null,
    unitId: input.unit?.id ?? null,
    label: input.unit?.label ?? null,
    field: input.field ?? null,
    reason: input.reason,
    message: input.message ?? SKIP_MESSAGES[input.reason],
    value: input.value ?? null,
  };
}

/* Reading one row --------------------------------------------------------- */

type RowRead = {
  values: Partial<Record<SheetStructureField, string | null>>;
  invalid: Array<{ field: SheetField; message: string; value: string }>;
  price: { hasTotal: boolean; hasRate: boolean; total: string | null; rate: string | null } | null;
};

function readField(read: FieldRead, field: SheetField, cell: SheetCell | undefined, out: RowRead): void {
  if (read.ok) out.values[field as SheetStructureField] = read.value;
  else out.invalid.push({ field, message: read.message, value: cellText(cell) });
}

/**
 * The values of one row, field by field: only the columns the sheet has. The
 * type is read against the company's types; a retired type stands only for a
 * unit that already has it. The gross area is read only when the unit is (or
 * is becoming) land.
 */
function readRow(row: readonly SheetCell[], at: Partial<Record<SheetColumn, number>>, types: readonly DiffType[], current: { typeId: string | null; category: UnitTypeCategory | null }): RowRead & { category: UnitTypeCategory | null; typeOf: DiffType | null } {
  const out: RowRead = { values: {}, invalid: [], price: null };
  const cell = (column: SheetColumn) => (at[column] === undefined ? undefined : row[at[column]!] ?? { kind: "blank" as const });
  let typeOf: DiffType | null = null;
  if (at.type !== undefined) {
    const text = nameText(cell("type"));
    if (text === null) {
      if (current.typeId !== null) out.invalid.push({ field: "type", message: "A unit always has a type; an empty Type cell is left as it is.", value: "" });
    } else {
      const match = matchUnitType(types, text);
      if (match.kind !== "one") out.invalid.push({ field: "type", message: match.kind === "many" ? `"${text}" matches more than one unit type.` : `There is no unit type called "${text}".`, value: text });
      else if (!match.item.isActive && match.item.id !== current.typeId) out.invalid.push({ field: "type", message: `${match.item.name} is retired. Choose a unit type in use.`, value: text });
      else {
        out.values.type = match.item.id;
        typeOf = match.item;
      }
    }
  }
  if (at.orientation !== undefined) readField(readOrientation(cell("orientation")!), "orientation", cell("orientation"), out);
  for (const field of AREA_COLUMNS) if (at[field] !== undefined) readField(readArea(cell(field)!, field), field, cell(field), out);
  for (const field of COUNT_COLUMNS) if (at[field] !== undefined) readField(readCount(cell(field)!, field), field, cell(field), out);
  const category = typeOf?.category ?? current.category;
  if (at.grossArea !== undefined && category !== null && grossAreaIsTyped(category)) readField(readArea(cell("grossArea")!, "grossArea"), "grossArea", cell("grossArea"), out);
  const hasTotal = at.totalPrice !== undefined;
  const hasRate = at.pricePerSqm !== undefined;
  if (hasTotal || hasRate) {
    const total = hasTotal ? readMoney(cell("totalPrice")!, SHEET_HEADERS.totalPrice.en) : ({ ok: true, value: null } as const);
    const rate = hasRate ? readMoney(cell("pricePerSqm")!, SHEET_HEADERS.pricePerSqm.en) : ({ ok: true, value: null } as const);
    if (!total.ok) out.invalid.push({ field: "price", message: total.message, value: cellText(cell("totalPrice")) });
    else if (!rate.ok) out.invalid.push({ field: "price", message: rate.message, value: cellText(cell("pricePerSqm")) });
    else out.price = { hasTotal, hasRate, total: total.value, rate: rate.value };
  }
  return { ...out, category, typeOf };
}

/* The three-way comparison ------------------------------------------------- */

/** One field: the sheet's value, NESTO's, and what they were at the last confirmed sync. */
export function compareField(sheet: string | null, nesto: string | null, base: BaselineEntry | undefined): "agree" | "change" | "clash" | "newer" {
  if (sheet === nesto) return "agree";
  if (!base || base.s === undefined) return "change";
  const sheetMoved = sheet !== base.s;
  const nestoMoved = nesto !== base.n;
  if (sheetMoved && !nestoMoved) return "change";
  if (sheetMoved && nestoMoved) return "clash";
  // NESTO moved and the sheet did not — or neither moved since they last agreed, yet they differ (NESTO saved
  // the value differently than the sheet wrote it): either way the sheet is the one behind.
  return "newer";
}

type PriceRead = NonNullable<RowRead["price"]>;
export type PriceOutcome = { kind: "agree" } | { kind: "newer"; sheet: string | null; nesto: string | null } | { kind: "change" | "clash"; proposal: PriceProposal } | { kind: "skip"; reason: "price_inconsistent" | "no_area" };

/**
 * Whether a sheet's price per m² is what NESTO's total works out at. With no
 * sale area there is no rate to show, so only an empty cell agrees; with one,
 * an empty cell agrees only with no price.
 */
const rateAgrees = (rate: string | null, total: string | null, area: string | null) => {
  if (area === null) return rate === null;
  if (rate === null) return total === null;
  return total !== null && rateFromPrice(total, area) === rate;
};

/**
 * The price, read from two columns. Which column the sheet changed decides
 * the price it asks for: a new total is that total; a new price per m² is
 * that rate on the unit's sale area as it will be after this sync; both
 * changed must agree, to the cent, or neither is used. Without a baseline a
 * column "changed" when it differs from what NESTO has now — a rate compared
 * on the area NESTO has now, which is the area the downloaded rate was on.
 */
export function comparePrice(input: { read: PriceRead; nesto: string | null; base: BaselineEntry | undefined; areaNow: string | null; areaAfter: string | null }): PriceOutcome {
  const { read, nesto, base, areaNow, areaAfter } = input;
  const total = read.hasTotal ? read.total : null;
  const rate = read.hasRate ? read.rate : null;
  // Without a baseline, an empty cell beside a filled one in the other column is that column saying nothing:
  // a sheet may keep its prices in either. Alone, an empty price column asks for the price to be cleared.
  const totalMoved = read.hasTotal && (base?.s !== undefined ? total !== base.s : total !== null ? total !== nesto : rate === null && nesto !== null);
  const rateMoved =
    read.hasRate && (base?.r !== undefined ? rate !== base.r : rate !== null ? !rateAgrees(rate, nesto, areaNow) : !read.hasTotal && nesto !== null && areaNow !== null);

  if (!totalMoved && !rateMoved) {
    // What the sheet shows as the price: its total, else its rate on today's area, else none.
    const agrees = total !== null ? total === nesto : rate !== null ? rateAgrees(rate, nesto, areaNow) : nesto === null || (!read.hasTotal && areaNow === null);
    if (agrees) return { kind: "agree" };
    const shows = total !== null ? total : rate === null || areaNow === null ? null : priceFromRate(rate, areaNow);
    return { kind: "newer", sheet: shows, nesto };
  }

  let proposal: PriceProposal;
  const rateOf = (total: string | null) => (total === null || areaAfter === null ? null : rateFromPrice(total, areaAfter));
  if (totalMoved && rateMoved) {
    if (read.total === null && read.rate === null) proposal = { entry: "TOTAL", amount: null, total: null, rate: null, area: areaAfter };
    else if (read.total === null || read.rate === null || areaAfter === null || rateFromPrice(read.total, areaAfter) !== read.rate) return { kind: "skip", reason: "price_inconsistent" };
    else proposal = { entry: "TOTAL", amount: read.total, total: read.total, rate: read.rate, area: areaAfter };
  } else if (totalMoved) {
    proposal = { entry: "TOTAL", amount: read.total, total: read.total, rate: rateOf(read.total), area: areaAfter };
  } else if (read.rate === null) {
    // The rate was emptied: the price is cleared only when the sheet shows no total either.
    if (read.hasTotal && read.total !== null) return { kind: "skip", reason: "price_inconsistent" };
    proposal = { entry: "TOTAL", amount: null, total: null, rate: null, area: areaAfter };
  } else {
    if (areaAfter === null) return { kind: "skip", reason: "no_area" };
    // NESTO's price already is that rate on the new area (a sheet formula working the rate out, say): nothing to change.
    if (nesto !== null && rateFromPrice(nesto, areaAfter) === read.rate) return { kind: "agree" };
    proposal = { entry: "PER_SQM", amount: read.rate, total: priceFromRate(read.rate, areaAfter), rate: read.rate, area: areaAfter };
  }
  if (proposal.total === nesto) return { kind: "agree" };
  const nestoMoved = base !== undefined && nesto !== base.n;
  return { kind: nestoMoved ? "clash" : "change", proposal };
}

/** The unit's sale area now, and as it will be if the sheet's area changes are taken: the gross worked out again. */
function saleAreas(unit: DiffUnit, taken: Partial<Record<SheetStructureField, string | null>>, category: UnitTypeCategory): { now: string | null; after: string | null } {
  const now = saleArea({ saleableArea: unit.values.saleableArea, grossArea: unit.values.grossArea }).area;
  const pick = (field: SheetStructureField) => (field in taken ? (taken[field] ?? null) : unit.values[field]);
  const worked = workedOutAreas(category, { internalArea: pick("internalArea"), balconyArea: pick("balconyArea"), terraceArea: pick("terraceArea"), commonAreaAllocation: pick("commonAreaAllocation"), grossArea: pick("grossArea") });
  return { now, after: saleArea({ saleableArea: pick("saleableArea"), grossArea: worked.grossArea }).area };
}

/* The whole sheet ---------------------------------------------------------- */

function emptyRowAt(row: readonly SheetCell[], indexes: number[]): boolean {
  return indexes.every((index) => (row[index] ?? { kind: "blank" }).kind === "blank");
}

export function diffSheet(input: DiffInput): SheetDiff {
  const { grid, units, buildings, types, baselines, can } = input;
  const used = (index: number) => grid.rows.some((row) => (row[index] ?? { kind: "blank" }).kind !== "blank");
  const headers = mapHeaders(grid.header, used);
  const at = headers.at;
  // A column NESTO writes but never reads (Status) says nothing about whether a row is empty.
  const known = (Object.entries(at) as Array<[SheetColumn, number]>).filter(([column]) => !IGNORED_COLUMNS.has(column)).map(([, index]) => index);
  const check: SheetCheckDTO = {
    title: null,
    rows: grid.rows.filter((row) => !rowIsBlank(row)).length,
    columns: headers.columns.map((column) => ({ column: column.column, header: column.header, key: column.key, readOnly: column.key !== null && isReadOnlyColumn(column.key) })),
    unknownColumns: headers.unknown,
    hasCodeColumn: at.code !== undefined,
    typed: grid.typed,
  };
  const skipped: SheetSkipDTO[] = [];
  if (at.code === undefined) return { check, matched: [], newUnits: [], skipped, notInSheet: [] };

  const byKey = new Map<string, DiffUnit[]>();
  for (const unit of units) {
    for (const key of new Set([structureKey(unit.label), structureKey(unit.unitCode)])) {
      const list = byKey.get(key) ?? [];
      list.push(unit);
      byKey.set(key, list);
    }
  }
  const buildingOf = new Map(buildings.map((building) => [building.id, building]));
  const typeOf = new Map(types.map((type) => [type.id, type]));

  // First pass: which row is which unit, or a new one.
  const rowsOfUnit = new Map<string, Array<{ row: number; cells: readonly SheetCell[]; code: string }>>();
  const mentioned = new Set<string>();
  const fresh: Array<{ row: number; cells: readonly SheetCell[]; code: string; buildingText: string | null }> = [];
  grid.rows.forEach((cells, index) => {
    const row = index + 2;
    if (rowIsBlank(cells)) return;
    const code = readCode(cells[at.code!]);
    if (!code.ok) {
      skipped.push(sheetSkip({ reason: "invalid_code", row, value: cellText(cells[at.code!]), message: code.message }));
      return;
    }
    if (code.value === null) {
      if (!emptyRowAt(cells, known)) skipped.push(sheetSkip({ reason: "no_code", row }));
      return;
    }
    const buildingText = at.building === undefined ? null : nameText(cells[at.building]);
    const building = buildingText === null ? null : matchBuilding(buildings, buildingText);
    let candidates = byKey.get(structureKey(code.value)) ?? [];
    if (candidates.length > 1 && building?.kind === "one") candidates = candidates.filter((unit) => unit.buildingId === building.item.id);
    if (candidates.length > 1 || (candidates.length === 0 && (byKey.get(structureKey(code.value))?.length ?? 0) > 1)) {
      skipped.push(sheetSkip({ reason: "ambiguous_code", row, code: code.value, message: building?.kind === "one" ? "This code matches more than one unit in that building." : undefined }));
      return;
    }
    const unit = candidates[0];
    if (unit) {
      if (building?.kind === "one" && building.item.id !== unit.buildingId) {
        // In the sheet, if not where NESTO has it: not listed as missing from it.
        mentioned.add(unit.id);
        skipped.push(sheetSkip({ reason: "building_mismatch", row, code: code.value, unit, value: buildingText, message: `NESTO has ${unit.label} in ${buildingOf.get(unit.buildingId)?.name ?? "another building"}. The sheet does not move units.` }));
        return;
      }
      const list = rowsOfUnit.get(unit.id) ?? [];
      list.push({ row, cells, code: code.value });
      rowsOfUnit.set(unit.id, list);
      return;
    }
    fresh.push({ row, cells, code: code.value, buildingText });
  });

  // Second pass: the units the sheet names once.
  const matched: MatchedUnit[] = [];
  const named = new Set<string>();
  for (const unit of units) {
    const rows = rowsOfUnit.get(unit.id);
    if (!rows) continue;
    named.add(unit.id);
    if (rows.length > 1) {
      for (const one of rows) skipped.push(sheetSkip({ reason: "duplicate_row", row: one.row, code: one.code, unit, message: `${unit.label} is on rows ${rows.map((r) => r.row).join(", ")} of the sheet.` }));
      continue;
    }
    const { row, cells, code } = rows[0]!;
    if (unit.archived) {
      skipped.push(sheetSkip({ reason: "archived", row, code, unit }));
      continue;
    }
    matched.push(compareUnit(unit, row, cells, code));
  }
  matched.sort((a, b) => a.row - b.row);

  function compareUnit(unit: DiffUnit, row: number, cells: readonly SheetCell[], code: string): MatchedUnit {
    const base = baselines.get(unit.id) ?? {};
    const read = readRow(cells, at, types, { typeId: unit.values.type, category: unit.category });
    for (const bad of read.invalid) skipped.push(sheetSkip({ reason: "invalid_value", row, code, unit, field: bad.field, value: bad.value, message: bad.message }));
    const outcomes: FieldOutcome[] = [];
    const sheet: Partial<Record<SheetField, SheetSide>> = {};
    const taken: Partial<Record<SheetStructureField, string | null>> = {};
    for (const field of SHEET_FIELDS) {
      if (field === "price" || !(field in read.values)) continue;
      const value = read.values[field] ?? null;
      sheet[field] = { s: value };
      const kind = compareField(value, unit.values[field], base[field]);
      if (kind === "agree") outcomes.push({ kind, field });
      else if (kind === "newer") outcomes.push({ kind, field, sheet: value, nesto: unit.values[field] });
      else {
        taken[field] = value;
        outcomes.push(kind === "change" ? { kind, field, from: unit.values[field], to: value, price: null } : { kind, field, sheet: value, nesto: unit.values[field], price: null });
      }
    }
    if (read.price) {
      const category = "type" in taken ? (typeOf.get(taken.type ?? "")?.category ?? unit.category) : unit.category;
      const areas = saleAreas(unit, taken, category);
      sheet.price = { ...(read.price.hasTotal ? { s: read.price.total } : {}), ...(read.price.hasRate ? { r: read.price.rate } : {}) };
      const price = comparePrice({ read: read.price, nesto: unit.values.price, base: base.price, areaNow: areas.now, areaAfter: areas.after });
      if (price.kind === "agree") outcomes.push({ kind: "agree", field: "price" });
      else if (price.kind === "newer") outcomes.push({ kind: "newer", field: "price", sheet: price.sheet, nesto: price.nesto });
      else if (price.kind === "skip") skipped.push(sheetSkip({ reason: price.reason, row, code, unit, field: "price" }));
      else if (unit.status === "SOLD") skipped.push(sheetSkip({ reason: "sold", row, code, unit, field: "price", value: price.proposal.total }));
      else if (!can.managePrice) skipped.push(sheetSkip({ reason: "price_not_allowed", row, code, unit, field: "price", value: price.proposal.total }));
      else if (price.kind === "change") outcomes.push({ kind: "change", field: "price", from: unit.values.price, to: price.proposal.total, price: price.proposal });
      else outcomes.push({ kind: "clash", field: "price", sheet: price.proposal.total, nesto: unit.values.price, price: price.proposal });
    }
    return { unit, row, outcomes, sheet };
  }

  // New units: a building, floor and type that exist, and a code nobody has.
  const takenKeys = new Set(units.flatMap((unit) => [structureKey(unit.unitCode), structureKey(unit.label)]));
  const planned: Array<NewUnitPlan & { key: string }> = [];
  for (const candidate of fresh) {
    const { row, cells, code, buildingText } = candidate;
    if (!can.createUnit) {
      skipped.push(sheetSkip({ reason: "not_allowed_create", row, code }));
      continue;
    }
    if (buildingText === null) {
      skipped.push(sheetSkip({ reason: "missing_building", row, code }));
      continue;
    }
    const building = matchBuilding(buildings, buildingText);
    if (building.kind !== "one") {
      skipped.push(sheetSkip({ reason: building.kind === "many" ? "ambiguous_building" : "unknown_building", row, code, value: buildingText }));
      continue;
    }
    const floorText = at.floor === undefined ? null : nameText(cells[at.floor]);
    if (floorText === null) {
      skipped.push(sheetSkip({ reason: "missing_floor", row, code }));
      continue;
    }
    const floor = matchFloor(building.item.floors, floorText);
    if (floor.kind !== "one") {
      skipped.push(sheetSkip({ reason: "unknown_floor", row, code, value: floorText, message: `${building.item.name} has no floor called "${floorText}".` }));
      continue;
    }
    const typeText = at.type === undefined ? null : nameText(cells[at.type]);
    if (typeText === null) {
      skipped.push(sheetSkip({ reason: "missing_type", row, code }));
      continue;
    }
    const type = matchUnitType(types, typeText);
    if (type.kind !== "one") {
      skipped.push(sheetSkip({ reason: "unknown_type", row, code, value: typeText, message: type.kind === "many" ? `"${typeText}" matches more than one unit type.` : undefined }));
      continue;
    }
    if (!type.item.isActive) {
      skipped.push(sheetSkip({ reason: "retired_type", row, code, value: typeText, message: `${type.item.name} is retired. Choose a unit type in use.` }));
      continue;
    }
    // "T-502" in building T is unit 502 of T, as every screen names it (`unitLabel`).
    const prefix = building.item.code?.trim();
    const unitCode = prefix && structureKey(code).startsWith(`${structureKey(prefix)}-`) && code.length > prefix.length + 1 ? code.slice(prefix.length + 1).trim() : code;
    const label = unitLabel(building.item.code, unitCode);
    const key = structureKey(unitCode);
    if (takenKeys.has(key) || takenKeys.has(structureKey(label))) {
      skipped.push(sheetSkip({ reason: "code_taken", row, code, message: `NESTO already has a unit ${label}.` }));
      continue;
    }
    const read = readRow(cells, at, types, { typeId: null, category: type.item.category });
    for (const bad of read.invalid) if (bad.field !== "type") skipped.push(sheetSkip({ reason: "invalid_value", row, code, field: bad.field, value: bad.value, message: bad.message }));
    const values = Object.fromEntries(Object.entries(read.values).filter(([field]) => field !== "type")) as NewUnitPlan["values"];
    const sheet: Partial<Record<SheetField, SheetSide>> = { type: { s: type.item.id } };
    for (const field of Object.keys(values) as Array<keyof typeof values>) sheet[field] = { s: values[field] ?? null };
    let price: PriceProposal | null = null;
    if (read.price) {
      sheet.price = { ...(read.price.hasTotal ? { s: read.price.total } : {}), ...(read.price.hasRate ? { r: read.price.rate } : {}) };
      const area = saleArea({ saleableArea: values.saleableArea ?? null, grossArea: workedOutAreas(type.item.category, { internalArea: values.internalArea ?? null, balconyArea: values.balconyArea ?? null, terraceArea: values.terraceArea ?? null, commonAreaAllocation: values.commonAreaAllocation ?? null, grossArea: values.grossArea ?? null }).grossArea }).area;
      const outcome = comparePrice({ read: read.price, nesto: null, base: undefined, areaNow: null, areaAfter: area });
      if (outcome.kind === "skip") skipped.push(sheetSkip({ reason: outcome.reason, row, code, field: "price" }));
      else if (outcome.kind === "change" && outcome.proposal.total !== null) {
        if (can.managePrice) price = outcome.proposal;
        else skipped.push(sheetSkip({ reason: "price_not_allowed", row, code, field: "price", value: outcome.proposal.total }));
      }
    }
    planned.push({ id: newUnitId(key), key, row, unitCode, label, building: { id: building.item.id, name: building.item.name }, floor: { id: floor.item.id, name: floor.item.name }, type: type.item, values, price, sheet });
  }
  const counted = new Map<string, number>();
  for (const plan of planned) counted.set(plan.key, (counted.get(plan.key) ?? 0) + 1);
  const newUnits: NewUnitPlan[] = [];
  for (const { key, ...plan } of planned) {
    if (counted.get(key)! > 1) skipped.push(sheetSkip({ reason: "duplicate_row", row: plan.row, code: plan.label, message: `${plan.label} is on more than one row of the sheet.` }));
    else newUnits.push(plan);
  }

  skipped.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const notInSheet = units.filter((unit) => !unit.archived && !named.has(unit.id) && !mentioned.has(unit.id));
  return { check, matched, newUnits, skipped, notInSheet };
}

/* What the preview shows ---------------------------------------------------- */

export function toPriceDTO(price: PriceProposal | null): SheetPriceDTO | null {
  return price ? { entry: price.entry, total: price.total, rate: price.rate, area: price.area } : null;
}

/* Confirming ---------------------------------------------------------------- */

export type SheetChoices = {
  /** Ids of the changes and new units the person kept ticked. */
  accept: ReadonlySet<string>;
  /** Each clash's pick, by id; a clash without one is left for the next sync. */
  clashes: ReadonlyMap<string, "SHEET" | "NESTO">;
};

/** What confirming does to one unit: the technical fields to save, the price to save, and the clashes kept as NESTO has them. */
export type UnitPlan = {
  unit: DiffUnit;
  row: number;
  structure: Partial<Record<SheetStructureField, string | null>>;
  price: PriceProposal | null;
  keepNesto: SheetField[];
};

export function planUnits(diff: SheetDiff, choices: SheetChoices): UnitPlan[] {
  const plans: UnitPlan[] = [];
  for (const matched of diff.matched) {
    const plan: UnitPlan = { unit: matched.unit, row: matched.row, structure: {}, price: null, keepNesto: [] };
    for (const outcome of matched.outcomes) {
      const id = changeId(matched.unit.id, outcome.field);
      const take = (outcome.kind === "change" && choices.accept.has(id)) || (outcome.kind === "clash" && choices.clashes.get(id) === "SHEET");
      if (outcome.kind === "clash" && choices.clashes.get(id) === "NESTO") plan.keepNesto.push(outcome.field);
      if (!take || (outcome.kind !== "change" && outcome.kind !== "clash")) continue;
      if (outcome.field === "price") plan.price = outcome.price;
      else plan.structure[outcome.field] = outcome.kind === "change" ? outcome.to : outcome.sheet;
    }
    if (Object.keys(plan.structure).length || plan.price || plan.keepNesto.length) plans.push(plan);
  }
  return plans;
}

/**
 * The baseline after a confirmed sync, for a unit the sheet named: a field the
 * two now agree on, or that was saved from the sheet, records both sides as
 * they are; a clash kept as NESTO has it records the sheet's value and keeps
 * NESTO's old one, so the next sync reads it as newer in NESTO rather than a
 * clash again; a change left unticked or refused, a clash left unpicked and
 * anything newer in NESTO keep the old baseline, so they come back as they
 * were. `current` is NESTO's value of each field after the confirm.
 */
export function nextBaseline(input: { previous: UnitBaseline | undefined; outcomes: readonly FieldOutcome[]; sheet: Partial<Record<SheetField, SheetSide>>; saved: ReadonlySet<SheetField>; keptNesto: ReadonlySet<SheetField>; current: Record<SheetField, string | null> }): UnitBaseline {
  const next: UnitBaseline = { ...(input.previous ?? {}) };
  for (const outcome of input.outcomes) {
    const side = input.sheet[outcome.field];
    if (!side) continue;
    const field = outcome.field;
    if (outcome.kind === "agree" || input.saved.has(field)) next[field] = { ...side, n: input.current[field] };
    else if (outcome.kind === "clash" && input.keptNesto.has(field) && input.previous?.[field]) next[field] = { ...side, n: input.previous[field]!.n };
  }
  return next;
}

/**
 * A new unit's first baseline: every field the sheet gave, beside what the
 * unit was created with. A price the sheet gave that was not saved (no grant,
 * no area) is left out, so the next sync offers it again.
 */
export function newUnitBaseline(sheet: Partial<Record<SheetField, SheetSide>>, current: Record<SheetField, string | null>, saved: ReadonlySet<SheetField>): UnitBaseline {
  const baseline: UnitBaseline = {};
  for (const field of SHEET_FIELDS) {
    const side = sheet[field];
    if (!side) continue;
    if (field === "price" && !saved.has("price") && !((side.s ?? null) === null && (side.r ?? null) === null && current.price === null)) continue;
    baseline[field] = { ...side, n: current[field] };
  }
  return baseline;
}
