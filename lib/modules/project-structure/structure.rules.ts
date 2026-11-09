import type { UnitTypeCategory } from "@/config/unit-types";
import type { Locale } from "@/lib/i18n/config";
import { stockFloorName } from "@/lib/i18n/stock-names";
import { type CountField, type FloorLevelType, NET_AREA_PARTS, type UnitAttributeKey, UNIT_ATTRIBUTES } from "./structure.types";

/**
 * The rules the browser previews and the server enforces (E-05B §12-§15, §41-§44,
 * §74, §112). Pure and client-safe, so a preview never disagrees with the save.
 */

/**
 * How names and codes are compared: trimmed, whitespace collapsed, Unicode
 * NFKC, upper case (§112, §113). `a-901` and `A-901` are one code; the value
 * shown is always what was typed.
 */
export function structureKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

/* Floors ------------------------------------------------------------------- */

export function levelTypeForNumber(number: number): FloorLevelType {
  if (number < 0) return "BASEMENT";
  if (number === 0) return "GROUND";
  return "STANDARD";
}

/**
 * The name a floor gets unless somebody types another: -1 → Basement 1, 0 →
 * Ground Floor (§12, §38). In the language of whoever creates it — an Albanian
 * reader is offered "Bodrumi 1", "Kati përdhe" — and either language's name is
 * shown to each reader in their own (lib/i18n/stock-names.ts).
 */
export function defaultFloorName(levelType: FloorLevelType, number: number | null, locale: Locale = "en"): string {
  switch (levelType) {
    case "BASEMENT":
      return stockFloorName("BASEMENT", number === null ? null : Math.abs(number), locale);
    case "MEZZANINE":
      return stockFloorName("MEZZANINE", number === 0 ? null : number, locale);
    case "GROUND":
    case "TECHNICAL":
    case "ROOF":
      return stockFloorName(levelType, null, locale);
    default:
      return stockFloorName(levelType, number, locale);
  }
}

/**
 * A floor's identity inside its building (§14): level type and number, or level
 * type and name for a level without a number. Floor 9 once per building; a
 * mezzanine at level 0 beside the ground floor; one roof.
 */
export function floorKeyOf(levelType: FloorLevelType, number: number | null, name: string): string {
  return number === null ? `${levelType}:${structureKey(name)}` : `${levelType}:${number}`;
}

/**
 * Where a floor falls in the default order (§15): basements deepest first,
 * ground, mezzanine, the numbered floors, then roof and technical levels.
 */
export function floorRank(levelType: FloorLevelType, number: number | null): number {
  switch (levelType) {
    case "ROOF":
      return 1_000_000 + (number ?? 0);
    case "TECHNICAL":
      return 1_000_500 + (number ?? 0);
    case "MEZZANINE":
      return (number ?? 0) * 10 + 5;
    case "BASEMENT":
      return number === null ? -5 : number * 10;
    case "OTHER":
      return number === null ? 900_000 : number * 10 + 7;
    default:
      return number === null ? 800_000 : number * 10;
  }
}

/**
 * Places new floors among a building's existing ones: each goes before the
 * first floor that ranks above it, otherwise at the end. A building somebody
 * reordered by hand keeps that order; new floors slot in beside it.
 */
type Placed = { levelType: FloorLevelType; number: number | null };

export function placeFloors<E extends Placed, A extends Placed>(existing: E[], added: A[]): Array<E | A> {
  const order: Array<E | A> = [...existing];
  for (const floor of added) {
    const rank = floorRank(floor.levelType, floor.number);
    const index = order.findIndex((candidate) => floorRank(candidate.levelType, candidate.number) > rank);
    if (index === -1) order.push(floor);
    else order.splice(index, 0, floor);
  }
  return order;
}

export type FloorDraft = { number: number | null; name: string; levelType: FloorLevelType };

/** From -2 to 12 → Basement 2 … Floor 12 (§37, §38), named in `locale`. */
export function planFloorRange(from: number, to: number, locale: Locale = "en"): FloorDraft[] {
  const drafts: FloorDraft[] = [];
  for (let number = from; number <= to; number += 1) {
    const levelType = levelTypeForNumber(number);
    drafts.push({ number, levelType, name: defaultFloorName(levelType, number, locale) });
  }
  return drafts;
}

/* Unit codes ---------------------------------------------------------------- */

export type CodePattern = { prefix: string; start: number; end: number; padding: number; suffix: string };

/** prefix + padded number + suffix: A-901 … A-908, P-001 … P-050, B2-0501 … (§43). */
export function generateUnitCodes(pattern: CodePattern): string[] {
  const codes: string[] = [];
  for (let number = pattern.start; number <= pattern.end; number += 1) {
    codes.push(`${pattern.prefix}${String(number).padStart(pattern.padding, "0")}${pattern.suffix}`);
  }
  return codes;
}

/** In-batch repeats and codes the project already holds, by normalised key (§44). */
export function findCodeConflicts(codes: string[], existingKeys: Iterable<string>): Array<{ index: number; value: string; reason: "EXISTS" | "REPEATED" }> {
  const taken = new Set(existingKeys);
  const seen = new Set<string>();
  const conflicts: Array<{ index: number; value: string; reason: "EXISTS" | "REPEATED" }> = [];
  codes.forEach((value, index) => {
    const key = structureKey(value);
    if (taken.has(key)) conflicts.push({ index, value, reason: "EXISTS" });
    else if (seen.has(key)) conflicts.push({ index, value, reason: "REPEATED" });
    seen.add(key);
  });
  return conflicts;
}

/**
 * A code for a unit copied to another floor (§98): the source floor's number at
 * the head of the code's last run of digits becomes the target's, keeping its
 * width. A-801 on Floor 8 → A-901 on Floor 9; B2-0501 → B2-0601. A code that
 * does not carry the floor number comes back unchanged, for the person to edit.
 */
export function suggestCopiedCode(code: string, sourceNumber: number | null, targetNumber: number | null): string {
  if (sourceNumber === null || targetNumber === null || sourceNumber < 0 || targetNumber < 0) return code;
  const match = /(\d+)(?!.*\d)/.exec(code);
  if (!match) return code;
  const digits = match[1]!;
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  const source = String(sourceNumber);
  if (!trimmed.startsWith(source) || trimmed.length <= source.length) return code;
  const replaced = `${targetNumber}${trimmed.slice(source.length)}`;
  const width = Math.max(digits.length, replaced.length);
  return `${code.slice(0, match.index)}${replaced.padStart(width, "0")}${code.slice(match.index + digits.length)}`;
}

/* Fields by type ------------------------------------------------------------ */

/** Which counts a category is expected to carry (§22, §74). Everything else stays available. */
const EXPECTED_COUNTS: Record<UnitTypeCategory, ReadonlyArray<CountField>> = {
  RESIDENTIAL: ["bedrooms", "bathrooms", "storage"],
  COMMERCIAL: ["bathrooms"],
  PARKING: [],
  STORAGE: [],
  LAND: [],
  OTHER: ["bedrooms", "bathrooms", "storage"],
};

export function expectsCount(category: UnitTypeCategory, field: CountField): boolean {
  return EXPECTED_COUNTS[category].includes(field);
}

/* Worked-out areas (2026-11) ------------------------------------------------- */

/** Land has no internal area to add up: its gross area is the plot, typed as it is. */
export function grossAreaIsTyped(category: UnitTypeCategory): boolean {
  return category === "LAND";
}

/** Exact cents of a canonical area ("52.68"); areas are never added as floats (§23). */
function areaCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function areaFromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** The sum of the areas given; `null` when none is — nothing typed is not zero. */
function sumAreas(values: Array<string | null | undefined>): string | null {
  const given = values.filter((value): value is string => typeof value === "string" && value !== "");
  return given.length ? areaFromCents(given.reduce((total, value) => total + areaCents(value), 0)) : null;
}

/**
 * The net and gross areas a unit's typed areas make (2026-11): net = internal +
 * balcony + terrace, gross = net + common area allocation. The server writes
 * them on every save and the form shows them as they will be saved, so the two
 * never disagree. Land keeps the gross area it was given. Areas are canonical
 * strings with at most two decimals, as the schema leaves them.
 */
export function workedOutAreas(
  category: UnitTypeCategory,
  areas: { internalArea: string | null; balconyArea: string | null; terraceArea: string | null; commonAreaAllocation: string | null; grossArea: string | null },
): { netArea: string | null; grossArea: string | null } {
  const netArea = sumAreas(NET_AREA_PARTS.map((field) => areas[field]));
  return { netArea, grossArea: grossAreaIsTyped(category) ? areas.grossArea : sumAreas([netArea, areas.commonAreaAllocation]) };
}

export function attributesFor(category: UnitTypeCategory): UnitAttributeKey[] {
  return (Object.keys(UNIT_ATTRIBUTES) as UnitAttributeKey[]).filter((key) => (UNIT_ATTRIBUTES[key].categories as readonly string[]).includes(category));
}

/**
 * Warnings, never refusals (§74): bedrooms on a parking space are probably a
 * mistake, but a project may have a reason, so the unit still saves. Findings,
 * so a page can put them in its reader's words.
 */
export type UnitWarning = { kind: "count"; field: CountField } | { kind: "saleableBelowInternal" };

export function unitWarningFindings(
  category: UnitTypeCategory,
  values: { bedrooms?: number | null; bathrooms?: number | null; storage?: number | null; internalArea?: string | number | null; saleableArea?: string | number | null },
): UnitWarning[] {
  const findings: UnitWarning[] = [];
  for (const field of ["bedrooms", "bathrooms", "storage"] as const) {
    const value = values[field];
    if (value !== null && value !== undefined && value > 0 && !expectsCount(category, field)) findings.push({ kind: "count", field });
  }
  const internal = values.internalArea === null || values.internalArea === undefined || values.internalArea === "" ? null : Number(values.internalArea);
  const saleable = values.saleableArea === null || values.saleableArea === undefined || values.saleableArea === "" ? null : Number(values.saleableArea);
  if (internal !== null && saleable !== null && saleable < internal) findings.push({ kind: "saleableBelowInternal" });
  return findings;
}

/** The same findings in English, as the API answers them. */
export function unitWarnings(category: UnitTypeCategory, values: Parameters<typeof unitWarningFindings>[1]): string[] {
  const typeWord = category.toLowerCase();
  return unitWarningFindings(category, values).map((finding) =>
    finding.kind === "count" ? `A ${typeWord} unit does not usually have ${finding.field}.` : "The saleable area is smaller than the internal area.",
  );
}
