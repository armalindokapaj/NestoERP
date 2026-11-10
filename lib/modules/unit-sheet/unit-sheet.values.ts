import type { UnitTypeCategory } from "@/config/unit-types";
import { parseDecimalInput, type DecimalRule } from "@/lib/forms/decimal";
import type { Locale } from "@/lib/i18n/config";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { createUnitSchema, UNIT_CODE_MAX } from "@/lib/modules/project-structure/structure.schema";
import { structureKey } from "@/lib/modules/project-structure/structure.rules";
import { AREA_LABELS, COUNT_LABELS, type CountField, ORIENTATION_LABELS, UNIT_ORIENTATIONS, type UnitOrientation } from "@/lib/modules/project-structure/structure.types";
import type { SheetCell } from "./unit-sheet.parse";

/**
 * A cell read as the value of one field (2026-11-10). Pure and client-safe.
 *
 * The unit forms' own rules decide what a value may be — the same schema
 * (`createUnitSchema`) checks an area of 0 or more with two decimals, 0-3
 * bedrooms, 1-3 bathrooms, 0 or 1 storage room — so the sheet can set nothing
 * the Edit unit dialog would refuse. A number Google typed is used as the
 * number it is; a number written as text is read by the shared decimal rule
 * (`parseDecimalInput`): "9,5" and "9.5" are nine and a half, and "1,234",
 * which an English and an Albanian reader read differently, is refused rather
 * than guessed. What cannot be read is reported, never guessed. An empty cell
 * is the value cleared.
 */

export type FieldRead = { ok: true; value: string | null } | { ok: false; message: string };

const AREA_RULE = { scale: 2, maxIntegerDigits: 10, min: "0" } as const;
const MONEY_RULE = { scale: 2, maxIntegerDigits: 15, min: "0.01" } as const;

/**
 * A typed number as decimal text, without the binary noise a formula leaves
 * (0.1 + 0.2 is 0.30000000000000004): fifteen significant digits, which every
 * double holds exactly, and no exponent.
 */
export function numberAsDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(Number(value.toPrecision(15)));
  return /e/i.test(text) ? null : text;
}

/** A canonical amount with exactly two decimals: "9.5" → "9.50", "12" → "12.00". */
export function twoDecimals(value: string): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "-" : ""}${(whole ?? "0").replace(/^0+(?=\d)/, "") || "0"}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function decimalOf(cell: SheetCell, rule: DecimalRule): FieldRead {
  if (cell.kind === "blank") return { ok: true, value: null };
  const text = cell.kind === "number" ? numberAsDecimal(cell.value) : cell.text;
  if (text === null) return { ok: false, message: `${rule.label} "${cell.kind === "number" ? cell.text : ""}" is not a number NESTO can read.` };
  const parsed = parseDecimalInput(text, rule);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return { ok: true, value: twoDecimals(parsed.value) };
}

type AreaField = keyof typeof AREA_LABELS;

/** An area in m²: 0 or more, at most two decimals — the unit form's rule. */
export function readArea(cell: SheetCell, field: AreaField): FieldRead {
  const read = decimalOf(cell, { label: AREA_LABELS[field], ...AREA_RULE });
  if (!read.ok || read.value === null) return read;
  const checked = createUnitSchema.shape.internalArea.safeParse(read.value);
  return checked.success ? read : { ok: false, message: checked.error.issues[0]?.message ?? "Enter an area of 0 or more, with at most two decimals." };
}

/** An amount of money above zero with at most two decimals: a total price, or a price per m². */
export function readMoney(cell: SheetCell, label: string): FieldRead {
  return decimalOf(cell, { label, ...MONEY_RULE });
}

/** A count from its short list (0-3 bedrooms, 1-3 bathrooms, 0 or 1 storage room): the unit form's rule. */
export function readCount(cell: SheetCell, field: CountField): FieldRead {
  if (cell.kind === "blank") return { ok: true, value: null };
  let value: number;
  if (cell.kind === "number") value = cell.value;
  else if (/^\d{1,3}$/.test(cell.text.trim())) value = Number(cell.text.trim());
  else value = Number.NaN;
  const checked = createUnitSchema.shape[field].safeParse(Number.isFinite(value) ? value : cell.text);
  if (!checked.success || checked.data === null) return { ok: false, message: checked.success ? `${COUNT_LABELS[field]}: "${cellLabel(cell)}" is not a number.` : (checked.error.issues[0]?.message ?? `${COUNT_LABELS[field]}: "${cellLabel(cell)}" is not allowed.`) };
  return { ok: true, value: String(checked.data) };
}

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The orientation names, in both languages. Repeated from the page
 * dictionaries on purpose: what a downloaded file says must still be read
 * after a page's wording changes.
 */
const ORIENTATION_SQ: Record<UnitOrientation, string> = {
  N: "Veri",
  NE: "Verilindje",
  E: "Lindje",
  SE: "Juglindje",
  S: "Jug",
  SW: "Jugperëndim",
  W: "Perëndim",
  NW: "Veriperëndim",
  MULTI: "Disa",
  UNKNOWN: "E panjohur",
};

const ORIENTATION_INDEX: ReadonlyMap<string, UnitOrientation> = (() => {
  const index = new Map<string, UnitOrientation>();
  for (const key of UNIT_ORIENTATIONS) for (const name of [key, ORIENTATION_LABELS[key], ORIENTATION_SQ[key]]) index.set(fold(name), key);
  return index;
})();

/** An orientation's name as a reader of `locale` reads it. */
export function orientationName(key: UnitOrientation, locale: Locale): string {
  return locale === "sq" ? ORIENTATION_SQ[key] : ORIENTATION_LABELS[key];
}

/** An orientation by its key (NE), its English name (North-east) or its Albanian one (Verilindje). */
export function readOrientation(cell: SheetCell): FieldRead {
  if (cell.kind === "blank") return { ok: true, value: null };
  const key = ORIENTATION_INDEX.get(fold(cell.text));
  return key ? { ok: true, value: key } : { ok: false, message: `There is no orientation called "${cell.text}".` };
}

function cellLabel(cell: SheetCell): string {
  return cell.kind === "blank" ? "" : cell.text;
}

/**
 * A unit code. A whole number Google typed (501) is its digits, however the
 * cell is formatted; anything else is its text. At most the unit form's 80
 * characters.
 */
export function readCode(cell: SheetCell | undefined): FieldRead {
  if (!cell || cell.kind === "blank") return { ok: true, value: null };
  const text = cell.kind === "number" && Number.isInteger(cell.value) && Math.abs(cell.value) < 1e15 ? String(cell.value) : cell.text.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text) return { ok: true, value: null };
  if (text.length > UNIT_CODE_MAX) return { ok: false, message: `A unit code is at most ${UNIT_CODE_MAX} characters.` };
  return { ok: true, value: text };
}

/** Plain text of a naming cell (building, floor, type): a whole number as its digits. */
export function nameText(cell: SheetCell | undefined): string | null {
  if (!cell || cell.kind === "blank") return null;
  const text = cell.kind === "number" && Number.isInteger(cell.value) ? String(cell.value) : cell.text.trim();
  return text || null;
}

/* Naming things the project already has ------------------------------------ */

export type Match<T> = { kind: "none" } | { kind: "one"; item: T } | { kind: "many" };

function single<T>(found: T[]): Match<T> {
  const unique = [...new Set(found)];
  if (unique.length === 0) return { kind: "none" };
  return unique.length === 1 ? { kind: "one", item: unique[0]! } : { kind: "many" };
}

/** A building by its name or its code, folded as codes are (`structureKey`). */
export function matchBuilding<T extends { name: string; code: string | null }>(buildings: readonly T[], text: string): Match<T> {
  const key = structureKey(text);
  return single(buildings.filter((building) => structureKey(building.name) === key || (building.code !== null && building.code.trim() !== "" && structureKey(building.code) === key)));
}

/**
 * A floor of a building by its name in either language — "Floor 5", "Kati 5"
 * and "kati 5" are one floor, and so are "Ground Floor" and "Kati përdhe"
 * (stock names, lib/i18n/stock-names.ts) — or by its number.
 */
export function matchFloor<T extends { name: string; number: number | null }>(floors: readonly T[], text: string): Match<T> {
  const key = structureKey(floorName(text, "en"));
  const byName = floors.filter((floor) => structureKey(floorName(floor.name, "en")) === key);
  if (byName.length) return single(byName);
  if (/^-?\d{1,3}$/.test(text.trim())) return single(floors.filter((floor) => floor.number === Number(text.trim())));
  return { kind: "none" };
}

/** A unit type by its code (APARTMENT) or its name in either language ("Apartment", "Apartament"). */
export function matchUnitType<T extends { name: string; code: string; category: UnitTypeCategory }>(types: readonly T[], text: string): Match<T> {
  const key = structureKey(unitTypeName(text, "en"));
  const plain = structureKey(text);
  return single(types.filter((type) => structureKey(type.code) === plain || structureKey(type.name) === plain || structureKey(unitTypeName(type.name, "en")) === key));
}
