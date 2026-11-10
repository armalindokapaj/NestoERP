import type { Locale } from "@/lib/i18n/config";

/**
 * The sheet's columns (2026-11-10): what "Download for Google Sheets" writes
 * in its first row, and what reading a sheet recognises. Client-safe.
 *
 * The names are the matching contract between a downloaded file and the sheet
 * it becomes, so they live here rather than in a page dictionary whose wording
 * may change: a file downloaded today must still be read next year. A header
 * is recognised in English or Albanian, whatever the reader's language, with
 * case, spacing, punctuation and accents ignored ("sipërfaqja e brendshme (m2)"
 * is "Sipërfaqja e brendshme (m²)"), and with or without the bracketed unit
 * or the note after a dash.
 */

export const SHEET_COLUMNS = [
  "code",
  "building",
  "floor",
  "type",
  "orientation",
  "internalArea",
  "balconyArea",
  "terraceArea",
  "netArea",
  "commonAreaAllocation",
  "grossArea",
  "saleableArea",
  "outdoorArea",
  "gardenArea",
  "bedrooms",
  "bathrooms",
  "storage",
  "totalPrice",
  "pricePerSqm",
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

/** The columns NESTO works out and the sheet never sets: the net area always; the gross area except for land. */
export const WORKED_OUT_COLUMNS: ReadonlySet<SheetColumn> = new Set<SheetColumn>(["netArea", "grossArea"]);

export const SHEET_HEADERS: Record<SheetColumn, Record<Locale, string>> = {
  code: { en: "Unit", sq: "Njësia" },
  building: { en: "Building", sq: "Ndërtesa" },
  floor: { en: "Floor", sq: "Kati" },
  type: { en: "Type", sq: "Lloji" },
  orientation: { en: "Orientation", sq: "Orientimi" },
  internalArea: { en: "Internal area (m²)", sq: "Sipërfaqja e brendshme (m²)" },
  balconyArea: { en: "Balcony area (m²)", sq: "Sipërfaqja e ballkonit (m²)" },
  terraceArea: { en: "Terrace area (m²)", sq: "Sipërfaqja e tarracës (m²)" },
  netArea: { en: "Net area (m²) – worked out", sq: "Sipërfaqja neto (m²) – e llogaritur" },
  commonAreaAllocation: { en: "Common area allocation (m²)", sq: "Pjesa e ambienteve të përbashkëta (m²)" },
  grossArea: { en: "Gross area (m²) – worked out, typed for land", sq: "Sipërfaqja bruto (m²) – e llogaritur, për truallin shkruhet" },
  saleableArea: { en: "Saleable area (m²)", sq: "Sipërfaqja e shitshme (m²)" },
  outdoorArea: { en: "Outdoor area (m²)", sq: "Sipërfaqja e jashtme (m²)" },
  gardenArea: { en: "Garden area (m²)", sq: "Sipërfaqja e kopshtit (m²)" },
  bedrooms: { en: "Bedrooms", sq: "Dhoma gjumi" },
  bathrooms: { en: "Bathrooms", sq: "Banjo" },
  storage: { en: "Storage", sq: "Depo" },
  totalPrice: { en: "Total price", sq: "Çmimi total" },
  pricePerSqm: { en: "Price per m²", sq: "Çmimi për m²" },
};

/**
 * A header as it is compared: accents and marks dropped, "m²" read as "m2",
 * lower case, and only letters and digits kept.
 */
export function headerKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/²/g, "2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** A header and its shorter forms: without the note after " – " or " - ", and without the bracketed unit. */
function headerForms(header: string): string[] {
  const withoutNote = header.split(/\s[–-]\s/)[0]!;
  const withoutUnit = withoutNote.replace(/\s*\([^)]*\)\s*$/, "");
  return [header, withoutNote, withoutUnit];
}

const HEADER_INDEX: ReadonlyMap<string, SheetColumn> = (() => {
  const index = new Map<string, SheetColumn>();
  for (const column of SHEET_COLUMNS) {
    for (const header of Object.values(SHEET_HEADERS[column])) {
      for (const form of headerForms(header)) {
        const key = headerKey(form);
        if (key && !index.has(key)) index.set(key, column);
      }
    }
  }
  return index;
})();

/** The column a header names, or null. */
export function columnOfHeader(header: string): SheetColumn | null {
  return HEADER_INDEX.get(headerKey(header)) ?? null;
}

/** "A", "B", … "Z", "AA": a column's letter from its zero-based index. */
export function columnLetter(index: number): string {
  let letter = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letter = String.fromCharCode(65 + digit) + letter;
    rest = Math.floor((rest - 1) / 26);
  }
  return letter;
}

export type HeaderMap = {
  /** Where each recognised column is: the first column with its name. */
  at: Partial<Record<SheetColumn, number>>;
  columns: Array<{ index: number; column: string; header: string; key: SheetColumn | null }>;
  /** Columns NESTO does not know, and a second column with a name already used: listed once, ignored. */
  unknown: Array<{ column: string; header: string }>;
};

/**
 * Which column of the sheet is which. A column whose header NESTO does not
 * know is ignored, and so is a second column with a name already taken — the
 * first one counts. A column without a header is listed only if it holds
 * something (`used`).
 */
export function mapHeaders(header: readonly string[], used: (index: number) => boolean = () => true): HeaderMap {
  const at: Partial<Record<SheetColumn, number>> = {};
  const columns: HeaderMap["columns"] = [];
  const unknown: HeaderMap["unknown"] = [];
  header.forEach((text, index) => {
    const trimmed = text.trim();
    const key = trimmed ? columnOfHeader(trimmed) : null;
    const letter = columnLetter(index);
    if (key && at[key] === undefined) {
      at[key] = index;
      columns.push({ index, column: letter, header: trimmed, key });
      return;
    }
    if (!trimmed && !used(index)) return;
    columns.push({ index, column: letter, header: trimmed, key: null });
    unknown.push({ column: letter, header: trimmed });
  });
  return { at, columns, unknown };
}
