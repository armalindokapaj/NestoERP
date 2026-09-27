/**
 * CSV cells that stay data in a spreadsheet (PRD #47 §69, PRD #30, AUD-08 §7).
 *
 * An export is read in Excel, LibreOffice or Google Sheets, and each of them
 * evaluates a cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage
 * return as a formula. A client name or a note typed as
 * `=HYPERLINK("https://…","Open")` would then run on the machine of whoever
 * opens the file. Such a cell is prefixed with an apostrophe — the convention
 * every spreadsheet recognises as "this is text" — and quoted. Quoting alone
 * is not protection: a quoted `"=1+1"` is still a formula once opened.
 *
 * Leading spaces and control characters do not hide one (AUD-01 §8): a
 * spreadsheet trims ` =1+1`, a no-break space or a line break before `=` and
 * evaluates what is left, so the formula character is looked for after any
 * Unicode whitespace and control characters, and a cell that starts with any
 * control character is guarded too.
 *
 * Text and numbers are told apart by the exporter, never guessed from the
 * value (AUD-08 §7, DT-18). A cell is a number only when the exporter says so —
 * a JavaScript number, or a decimal string in a column it declared numeric
 * (`csvNumber`, or `kinds` in `toCsv`). Then it is written bare, sign and all,
 * so a genuine negative amount `-120.50` still sums. A person's text that
 * merely looks like a number — a payee typed as `-120.50`, a code `+355` — is
 * text, and text beginning with `-` or `+` is guarded like any other formula
 * start. A declared number that is not a plain decimal is written as guarded
 * text rather than trusted.
 *
 * Leading zeros: CSV has no cell types, so `007` stays `007` in the file and a
 * spreadsheet may still read it as 7 on open. The file never adds a formula
 * (`="007"`) to force text — import the column as Text instead (AUD-08 §7).
 */
const FORMULA_START = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/;
const CONTROL_START = /^[\u0000-\u001f\u007f-\u009f]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NEEDS_QUOTES = /[",\n\r']/;

export type CsvValue = string | number | null | undefined;

/** How a column's values are written: as text (the default for strings) or as a trusted number. */
export type CsvKind = "text" | "number";

function quoted(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A person's text as a cell: guarded when it could start a formula, quoted when it must be. */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const formulaLike = FORMULA_START.test(value) || CONTROL_START.test(value);
  return quoted(formulaLike ? `'${value}` : value);
}

/**
 * A value the exporter vouches is numeric: a finite number, or a decimal
 * string such as a `Prisma.Decimal` rendered by `toFixed`. Written bare. Any
 * other value is not trusted as a number and is written as guarded text.
 */
export function csvNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return PLAIN_NUMBER.test(value) ? value : csvText(value);
}

/**
 * One cell. Without a kind, a JavaScript number is a number and a string is
 * text — `"-120.50"` as a string is guarded, because nothing said it was an
 * amount. Pass `"number"` for a column of decimal strings.
 */
export function csvCell(value: CsvValue, kind?: CsvKind): string {
  if (value === null || value === undefined) return "";
  if (kind === "number" || (kind === undefined && typeof value === "number")) return csvNumber(value);
  return csvText(String(value));
}

export type CsvOptions = {
  /** Keeps files that always quoted every cell doing so (numbers included: a quoted number is still read as one). */
  quoteAll?: boolean;
  lineBreak?: "\n" | "\r\n";
  /** Per column: which are trusted numbers. Missing entries follow `csvCell`'s default. */
  kinds?: ReadonlyArray<CsvKind | undefined>;
};

/** Rows to CSV text: header first, rows joined by `lineBreak`, no trailing line break. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<CsvValue>>,
  options: CsvOptions = {},
): string {
  const line = (row: ReadonlyArray<CsvValue>, header: boolean) =>
    row
      .map((value, index) => {
        const safe = header ? csvText(value === null || value === undefined ? "" : String(value)) : csvCell(value, options.kinds?.[index]);
        if (!options.quoteAll || safe.startsWith('"')) return safe;
        return `"${safe}"`;
      })
      .join(",");
  return [line(headers, true), ...rows.map((row) => line(row, false))].join(options.lineBreak ?? "\n");
}

/**
 * CSV text to rows of cells (RFC 4180): quoted cells may hold commas, quotes
 * written twice and line breaks; `\r\n` and `\n` both end a row; a byte-order
 * mark is dropped; wholly empty lines are skipped. A cell `csvCell` guarded
 * with an apostrophe comes back as the apostrophe-prefixed text it was written as.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}
