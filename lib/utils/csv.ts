/**
 * CSV cells that stay data in a spreadsheet (PRD #47 §69, PRD #30).
 *
 * An export is read in Excel, LibreOffice or Google Sheets, and each of them
 * evaluates a cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage
 * return as a formula. A client name or a note typed as
 * `=HYPERLINK("https://…","Open")` would then run on the machine of whoever
 * opens the file. Such a cell is prefixed with an apostrophe — the convention
 * every spreadsheet recognises as "this is text" — and quoted.
 *
 * Plain numbers keep their sign: a negative amount from the database is not a
 * formula, and turning `-120.50` into text would break the column's sums.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[",\n\r']/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text. `quoteAll` keeps files that always quoted every cell doing so. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
  options: { quoteAll?: boolean; lineBreak?: "\n" | "\r\n" } = {},
): string {
  const cell = (value: string | number | null | undefined) => {
    const safe = csvCell(value);
    if (!options.quoteAll || safe.startsWith('"')) return safe;
    return `"${safe}"`;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join(options.lineBreak ?? "\n");
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
