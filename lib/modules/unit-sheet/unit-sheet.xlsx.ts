import { deflateRawSync } from "node:zlib";

/**
 * A one-sheet .xlsx file (2026-11-10): what "Download for Google Sheets"
 * hands over, for the person to import into their sheet (File → Import →
 * Upload → Replace current sheet). Server only; no dependency beyond Node.
 *
 * Why .xlsx and not CSV: an .xlsx cell carries its type. A number stays the
 * number 9.5 in a sheet set to Albanian, where the CSV text "9.5" could be
 * read as a date, and a code such as "0501" stays text. Why no library: the
 * file is one sheet of plain cells — five small XML parts in a ZIP — and a
 * hand-written writer of that is shorter than the review of a dependency.
 * The ZIP is deflated with Node's own zlib.
 *
 * Text never becomes a formula: every text cell is an inline string (`<is>`),
 * which a spreadsheet stores as text whatever it says, and one that starts
 * like a formula (`=`, `+`, `-`, `@`, after any spaces or control characters)
 * also carries the "quote prefix" style, the spreadsheet's own mark for
 * "this is text". Numbers are written only from canonical decimal strings
 * NESTO produced; anything else is written as text.
 */

export type XlsxNumberFormat = "decimal" | "integer";
export type XlsxCell = { kind: "text"; text: string } | { kind: "number"; value: string; format: XlsxNumberFormat } | null;
export type XlsxColumn = { header: string; width: number; text?: boolean; muted?: boolean };

/* ZIP ----------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1 January 2026, 00:00, in the DOS format a ZIP entry dates itself with: the same bytes for the same content. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/* SpreadsheetML ------------------------------------------------------------- */

/** Characters XML 1.0 cannot hold at all. */
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/** The text without what XML cannot hold: those characters, and a surrogate that is not half of a pair. */
export function xmlSafe(value: string): string {
  const kept = value.replace(NOT_XML, "");
  let out = "";
  for (let index = 0; index < kept.length; index += 1) {
    const code = kept.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = kept.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += kept[index]! + kept[index + 1]!;
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += kept[index]!;
  }
  return out;
}

export function xmlText(value: string): string {
  return xmlSafe(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text a spreadsheet would read as a formula, as csv.ts guards it too. */
const FORMULA_START = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/;
const PLAIN_DECIMAL = /^-?\d{1,17}(\.\d{1,6})?$/;

/** Styles, by index into `cellXfs` below. */
const STYLE = { header: 1, text: 2, quoted: 3, decimal: 4, integer: 5, mutedDecimal: 6, mutedHeader: 7, mutedInteger: 8 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="1" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const columnName = (index: number): string => {
  let name = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
};

function textCell(ref: string, text: string, style: number): string {
  const kept = xmlSafe(text);
  const space = kept !== kept.trim() ? ' xml:space="preserve"' : "";
  const shown = FORMULA_START.test(kept) || /^[\u0000-\u001f\u007f-\u009f]/.test(kept) ? STYLE.quoted : style;
  return `<c r="${ref}" t="inlineStr" s="${shown}"><is><t${space}>${xmlText(kept)}</t></is></c>`;
}

function cellXml(ref: string, cell: XlsxCell, muted: boolean): string {
  if (cell === null) return "";
  if (cell.kind === "number" && PLAIN_DECIMAL.test(cell.value)) {
    const style = cell.format === "integer" ? (muted ? STYLE.mutedInteger : STYLE.integer) : muted ? STYLE.mutedDecimal : STYLE.decimal;
    return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
  }
  return textCell(ref, cell.kind === "number" ? cell.value : cell.text, STYLE.text);
}

/** A sheet's name: at most 31 characters, none of []:*?/\ (what a workbook allows). */
export function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";
}

/** The file: one sheet, its header row frozen, text columns formatted as text so a code typed later stays text. */
export function buildXlsx(input: { sheetName: string; columns: readonly XlsxColumn[]; rows: ReadonlyArray<ReadonlyArray<XlsxCell>> }): Uint8Array {
  const { columns, rows } = input;
  const cols = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(6, Math.min(60, column.width))}" customWidth="1"${column.text ? ` style="${STYLE.text}"` : ""}/>`).join("");
  const header = `<row r="1">${columns.map((column, index) => textCell(`${columnName(index)}1`, column.header, column.muted ? STYLE.mutedHeader : STYLE.header)).join("")}</row>`;
  const body = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      return `<row r="${r}">${columns.map((column, index) => cellXml(`${columnName(index)}${r}`, row[index] ?? null, Boolean(column.muted))).join("")}</row>`;
    })
    .join("");
  const lastRef = `${columnName(Math.max(columns.length, 1) - 1)}${rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${header}${body}</sheetData>
</worksheet>`;
  const name = xmlText(sheetName(input.sheetName));
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const encode = (text: string) => new TextEncoder().encode(text);
  return zip([
    {
      name: "[Content_Types].xml",
      data: encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    },
    {
      name: "_rels/.rels",
      data: encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    { name: "xl/workbook.xml", data: encode(workbook) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    { name: "xl/styles.xml", data: encode(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: encode(sheet) },
  ]);
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
