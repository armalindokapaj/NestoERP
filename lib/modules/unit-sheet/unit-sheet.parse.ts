/**
 * Turning what Google sends back into a grid of cells (2026-11-10). Pure.
 *
 * Two exports of the same tab are read. The Visualization API's JSON (`gviz`)
 * gives each number as a number — 9.5 is 9.5 whether the sheet shows "9.5",
 * "9,5" or "€9.50" — but it types each column by its majority and answers
 * null for a cell of the minority type (a text "n/a" in a column of numbers,
 * a code typed as 502 among codes like "T-501"). The CSV export gives every
 * cell exactly as the sheet shows it, minority or not. So a cell is the
 * number gviz gives when there is one, the text otherwise, and the CSV's text
 * where gviz answered null — when the two exports line up row for row and
 * header for header. When they do not, the CSV alone is used and every
 * number is read from its text by the shared decimal rule, which refuses
 * what it cannot read unambiguously.
 *
 * Nothing here is trusted: the content is a stranger's. It is only ever read
 * as text and numbers, capped in rows and columns.
 */

export type SheetCell = { kind: "blank" } | { kind: "number"; value: number; text: string } | { kind: "text"; text: string };

export type SheetGrid = {
  /** The first row, as written. */
  header: string[];
  /** Every row after it, each as wide as the widest row; trailing empty rows dropped. */
  rows: SheetCell[][];
  /** Whether typed values (gviz) were used; false when only the CSV could be read. */
  typed: boolean;
};

export type SheetLimits = { maxRows: number; maxColumns: number; maxCellLength: number };

/** Rows after the header, columns, and characters in one cell that a sheet may have. */
export const SHEET_LIMITS: SheetLimits = { maxRows: 5_000, maxColumns: 60, maxCellLength: 2_000 };

export class SheetParseError extends Error {
  constructor(
    readonly reason: "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "MALFORMED",
    message: string,
  ) {
    super(message);
  }
}

const BLANK: SheetCell = { kind: "blank" };

/** RFC 4180 CSV, as Google writes it: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string, limits: SheetLimits = SHEET_LIMITS): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const pushField = () => {
    if (row.length >= limits.maxColumns) {
      if (field.trim() !== "") throw new SheetParseError("TOO_MANY_COLUMNS", `The sheet has more than ${limits.maxColumns} columns.`);
    } else {
      row.push(field.length > limits.maxCellLength ? field.slice(0, limits.maxCellLength + 1) : field);
    }
    field = "";
  };
  // The text itself is already capped in bytes by the reader, so the rows are counted once it is read.
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === ",") pushField();
    else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else if (char === "\n") pushRow();
    else field += char;
  }
  if (quoted) throw new SheetParseError("MALFORMED", "The sheet's CSV ends inside a quoted cell.");
  if (field !== "" || row.length > 0) pushRow();
  while (rows.length && rows[rows.length - 1]!.every((cell) => cell.trim() === "")) rows.pop();
  // The header plus the most rows a sheet may have.
  if (rows.length > limits.maxRows + 1) throw new SheetParseError("TOO_MANY_ROWS", `The sheet has more than ${limits.maxRows} rows.`);
  return rows;
}

export type GvizCell = { v?: unknown; f?: unknown } | null;
export type GvizTable = { labels: string[]; types: string[]; rows: GvizCell[][] };
export type GvizRead = { ok: true; table: GvizTable } | { ok: false; reason: "access_denied" | "not_found" | "error" | "malformed" };

/**
 * The Visualization API's answer: `/*O_o*\/` then
 * `google.visualization.Query.setResponse({...});`, the object holding
 * `status`, `errors` and `table` — `cols` with `label` and `type`, `rows`
 * with `c`, each cell `{ v, f }` or null (developers.google.com/chart/
 * interactive/docs/dev/implementing_data_source#jsondatatable).
 */
export function parseGviz(text: string): GvizRead {
  const start = text.indexOf("setResponse(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end <= start) return { ok: false, reason: "malformed" };
  let body: unknown;
  try {
    body = JSON.parse(text.slice(start + "setResponse(".length, end));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!body || typeof body !== "object") return { ok: false, reason: "malformed" };
  const response = body as { status?: unknown; errors?: unknown; table?: unknown };
  if (response.status === "error") {
    const reasons = Array.isArray(response.errors) ? response.errors.map((error) => String((error as { reason?: unknown } | null)?.reason ?? "")) : [];
    if (reasons.some((reason) => reason === "access_denied" || reason === "user_not_authenticated")) return { ok: false, reason: "access_denied" };
    if (reasons.some((reason) => reason === "invalid_query" || reason === "not_found")) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "error" };
  }
  const table = response.table as { cols?: unknown; rows?: unknown } | undefined;
  if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) return { ok: false, reason: "malformed" };
  const labels = table.cols.map((col) => {
    const label = (col as { label?: unknown } | null)?.label;
    return typeof label === "string" ? label : "";
  });
  const types = table.cols.map((col) => {
    const type = (col as { type?: unknown } | null)?.type;
    return typeof type === "string" ? type : "string";
  });
  const rows = table.rows.map((row) => {
    const cells = (row as { c?: unknown } | null)?.c;
    return Array.isArray(cells) ? cells.map((cell) => (cell && typeof cell === "object" ? (cell as GvizCell) : null)) : [];
  });
  return { ok: true, table: { labels, types, rows } };
}

const fold = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** A number Google typed, as the text a person would read: its formatted value, or the number itself. */
function numberText(cell: { v?: unknown; f?: unknown }, csvText: string): string {
  if (typeof cell.f === "string" && cell.f.trim()) return cell.f.trim();
  return csvText || String(cell.v);
}

function emptyGviz(cell: GvizCell): boolean {
  return cell === null || cell.v === null || cell.v === undefined || (typeof cell.v === "string" && cell.v.trim() === "");
}

/** Whether the two exports describe the same rows and columns. */
function aligned(csvHeader: string[], csvRows: string[][], gviz: GvizTable): boolean {
  // gviz may answer a row whose every cell it typed null; it must still be there, and anything past the CSV's rows empty.
  if (gviz.rows.length < csvRows.length || gviz.rows.slice(csvRows.length).some((row) => !row.every(emptyGviz))) return false;
  const rows = gviz.rows.slice(0, csvRows.length);
  const width = Math.max(csvHeader.length, gviz.labels.length);
  for (let column = 0; column < width; column += 1) {
    if (fold(gviz.labels[column] ?? "") !== fold(csvHeader[column] ?? "")) return false;
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    for (let column = 0; column < row.length; column += 1) {
      const cell = row[column];
      if (cell && typeof cell.v === "string" && gviz.types[column] === "string" && fold(cell.v) !== fold(csvRows[index]![column] ?? "")) return false;
    }
  }
  return true;
}

/** One cell from the two exports, by the rule above. */
function mergedCell(gvizCell: GvizCell | undefined, type: string | undefined, csvText: string, limits: SheetLimits): SheetCell {
  const text = csvText.trim();
  if (gvizCell && typeof gvizCell.v === "number" && Number.isFinite(gvizCell.v) && type === "number") {
    return { kind: "number", value: gvizCell.v, text: numberText(gvizCell, text) };
  }
  if (gvizCell && typeof gvizCell.v === "string" && type === "string" && gvizCell.v.trim()) {
    return { kind: "text", text: gvizCell.v.trim().slice(0, limits.maxCellLength + 1) };
  }
  return text ? { kind: "text", text } : BLANK;
}

/**
 * The grid a sync reads: the CSV's rows and header, with gviz's typed values
 * laid over them when the two line up (see above). `gviz` is null when it
 * could not be read.
 */
export function mergeGrid(csv: string[][], gviz: GvizTable | null, limits: SheetLimits = SHEET_LIMITS): SheetGrid {
  const header = (csv[0] ?? []).map((cell) => cell.trim());
  const csvRows = csv.slice(1);
  if (csvRows.length > limits.maxRows) throw new SheetParseError("TOO_MANY_ROWS", `The sheet has more than ${limits.maxRows} rows.`);
  const width = Math.max(header.length, ...csvRows.map((row) => row.length));
  const typed = gviz !== null && aligned(header, csvRows, gviz);
  const rows = csvRows.map((row, index) =>
    Array.from({ length: width }, (_, column) => (typed ? mergedCell(gviz!.rows[index]?.[column], gviz!.types[column], row[column] ?? "", limits) : (row[column] ?? "").trim() ? ({ kind: "text", text: (row[column] ?? "").trim() } as SheetCell) : BLANK)),
  );
  return { header: Array.from({ length: width }, (_, column) => header[column] ?? ""), rows, typed };
}

/** Whether a row holds anything at all. */
export function rowIsBlank(row: readonly SheetCell[]): boolean {
  return row.every((cell) => cell.kind === "blank");
}

/** A cell's text as a person reads it, for messages and for text fields. */
export function cellText(cell: SheetCell | undefined): string {
  if (!cell || cell.kind === "blank") return "";
  return cell.text;
}
