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
