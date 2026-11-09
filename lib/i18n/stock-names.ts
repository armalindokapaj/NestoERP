import type { Locale } from "./config";

/**
 * Names the application itself writes into a company's data, shown in the
 * reader's language.
 *
 * A new company starts with ten unit types and eight project types
 * (config/unit-types.ts, config/project-types.ts), and a floor gets a name
 * unless somebody types one ("Floor 5", "Ground Floor": structure.rules.ts).
 * Those rows are the company's own and stay as they were written — this only
 * changes what a reader sees. A name that is exactly one of these stock names,
 * in the other language, is shown in the reader's; anything else — a name
 * somebody typed, or a stock name already in the reader's language — is shown
 * exactly as written.
 *
 * Client-safe: plain tables, no React and nothing of the server's.
 */

/* Unit and project types --------------------------------------------------- */

const UNIT_TYPES: ReadonlyArray<Record<Locale, string>> = [
  { en: "Apartment", sq: "Apartament" },
  { en: "Penthouse", sq: "Papafingo" },
  { en: "Villa", sq: "Vilë" },
  { en: "Office", sq: "Zyrë" },
  { en: "Shop", sq: "Dyqan" },
  { en: "Parking", sq: "Parkim" },
  { en: "Garage", sq: "Garazh" },
  { en: "Storage", sq: "Magazinë" },
  { en: "Land", sq: "Truall" },
  { en: "Other", sq: "Tjetër" },
];

const PROJECT_TYPES: ReadonlyArray<Record<Locale, string>> = [
  { en: "Residential", sq: "Rezidencial" },
  { en: "Commercial", sq: "Komercial" },
  { en: "Hospital", sq: "Spital" },
  { en: "Hotel", sq: "Hotel" },
  { en: "Industrial", sq: "Industrial" },
  { en: "Infrastructure", sq: "Infrastrukturë" },
  { en: "Mixed use", sq: "Me përdorim të përzier" },
  { en: "Other", sq: "Tjetër" },
];

const fold = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

type Entry = { row: Record<Locale, string>; written: Locale };

function indexOf(table: ReadonlyArray<Record<Locale, string>>): Map<string, Entry> {
  const index = new Map<string, Entry>();
  for (const row of table) for (const written of Object.keys(row) as Locale[]) if (!index.has(fold(row[written]))) index.set(fold(row[written]), { row, written });
  return index;
}

function shown(index: Map<string, Entry>, name: string, locale: Locale): string {
  const entry = index.get(fold(name));
  return entry && entry.written !== locale && entry.row[locale] !== entry.row[entry.written] ? entry.row[locale] : name;
}

const unitTypeIndex = indexOf(UNIT_TYPES);
const projectTypeIndex = indexOf(PROJECT_TYPES);

/** A unit type's name as the reader's language has it: "Apartment" ↔ "Apartament". */
export function unitTypeName(name: string, locale: Locale): string {
  return shown(unitTypeIndex, name, locale);
}

/** A project type's name as the reader's language has it: "Mixed use" ↔ "Me përdorim të përzier". */
export function projectTypeName(name: string, locale: Locale): string {
  return shown(projectTypeIndex, name, locale);
}

/* Floors ------------------------------------------------------------------- */

type FloorKind = "BASEMENT" | "GROUND" | "STANDARD" | "MEZZANINE" | "TECHNICAL" | "ROOF" | "OTHER";

/** The name a floor gets in each language: `n` is the number shown, or null for a level without one. */
const FLOOR_WORDS: Record<FloorKind, Record<Locale, { bare: string; numbered: ((n: number) => string) | null }>> = {
  BASEMENT: { en: { bare: "Basement", numbered: (n) => `Basement ${n}` }, sq: { bare: "Bodrumi", numbered: (n) => `Bodrumi ${n}` } },
  GROUND: { en: { bare: "Ground Floor", numbered: null }, sq: { bare: "Kati përdhe", numbered: null } },
  STANDARD: { en: { bare: "Floor", numbered: (n) => `Floor ${n}` }, sq: { bare: "Kati", numbered: (n) => `Kati ${n}` } },
  MEZZANINE: { en: { bare: "Mezzanine", numbered: (n) => `Mezzanine ${n}` }, sq: { bare: "Ndërkati", numbered: (n) => `Ndërkati ${n}` } },
  TECHNICAL: { en: { bare: "Technical Floor", numbered: null }, sq: { bare: "Kati teknik", numbered: null } },
  ROOF: { en: { bare: "Roof", numbered: null }, sq: { bare: "Tarraca", numbered: null } },
  OTHER: { en: { bare: "Level", numbered: (n) => `Level ${n}` }, sq: { bare: "Niveli", numbered: (n) => `Niveli ${n}` } },
};

/** The name a new floor is given (structure.rules.ts `defaultFloorName`), in a language. */
export function stockFloorName(kind: FloorKind, shownNumber: number | null, locale: Locale): string {
  const words = FLOOR_WORDS[kind][locale];
  return shownNumber === null || words.numbered === null ? words.bare : words.numbered(shownNumber);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every stock floor name, in both languages, as a pattern that gives back its kind and number. */
const FLOOR_PATTERNS: ReadonlyArray<{ kind: FloorKind; written: Locale; pattern: RegExp }> = (Object.keys(FLOOR_WORDS) as FloorKind[]).flatMap((kind) =>
  (Object.keys(FLOOR_WORDS[kind]) as Locale[]).map((written) => {
    const words = FLOOR_WORDS[kind][written];
    return { kind, written, pattern: new RegExp(`^${escape(words.bare.toLowerCase())}${words.numbered ? "(?: (-?\\d+))?" : ""}$`, "u") };
  }),
);

/** A floor's name as the reader's language has it: "Floor 5" ↔ "Kati 5", "Ground Floor" ↔ "Kati përdhe". */
export function floorName(name: string, locale: Locale): string {
  const folded = fold(name);
  for (const { kind, written, pattern } of FLOOR_PATTERNS) {
    const match = pattern.exec(folded);
    if (match) return written === locale ? name : stockFloorName(kind, match[1] === undefined ? null : Number(match[1]), locale);
  }
  return name;
}
