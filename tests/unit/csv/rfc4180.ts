/**
 * A strict RFC 4180 reader for the AUD-08 export tests (§9: "test actual
 * exported bytes with a parser").
 *
 * Written apart from `lib/utils/csv.ts` on purpose, so the serializer is never
 * its own oracle, and stricter than it: a quote inside an unquoted field, text
 * after a closing quote, an unterminated quote or a row whose width differs
 * from the header's is an error, not a best guess. It reads the bytes as a
 * spreadsheet would receive them: a UTF-8 byte-order mark is reported and
 * removed, and CRLF or LF ends a record.
 */
export type ReadCsv = { bom: boolean; header: string[]; rows: string[][]; lineBreak: "\r\n" | "\n" | null };

export function readCsvBytes(bytes: Uint8Array): ReadCsv {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  return { bom, ...readCsvText(text) };
}

export function readCsvText(text: string): Omit<ReadCsv, "bom"> {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let lineBreak: "\r\n" | "\n" | null = null;
  let index = 0;

  const endField = () => {
    record.push(field);
    field = "";
    closed = false;
  };
  const endRecord = (terminator: "\r\n" | "\n") => {
    if (lineBreak && lineBreak !== terminator) throw new Error(`Mixed line breaks at ${index}`);
    lineBreak = terminator;
    endField();
    records.push(record);
    record = [];
  };

  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        closed = true;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (field !== "" || closed) throw new Error(`Quote inside an unquoted field at ${index}`);
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r" && text[index + 1] === "\n") {
      endRecord("\r\n");
      index += 2;
      continue;
    }
    if (char === "\n") {
      endRecord("\n");
      index += 1;
      continue;
    }
    if (char === "\r") throw new Error(`A bare carriage return outside quotes at ${index}`);
    if (closed) throw new Error(`Text after a closing quote at ${index}`);
    field += char;
    index += 1;
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (field !== "" || record.length > 0 || closed) endRecord(lineBreak ?? "\n");

  const [header, ...rows] = records;
  if (!header) throw new Error("No header row");
  for (const [position, row] of rows.entries()) {
    if (row.length !== header.length) throw new Error(`Row ${position + 1} has ${row.length} fields, the header ${header.length}`);
  }
  return { header, rows, lineBreak };
}

/** The rows as objects keyed by header, for readable assertions. */
export function byHeader(read: Pick<ReadCsv, "header" | "rows">): Array<Record<string, string>> {
  return read.rows.map((row) => Object.fromEntries(read.header.map((name, position) => [name, row[position]!])));
}

/**
 * Whether a spreadsheet would evaluate this cell as a formula when it opens
 * the file: after the whitespace and control characters it trims, the cell
 * starts with `=`, `+`, `-` or `@` and is not a plain number.
 */
export function spreadsheetWouldEvaluate(cell: string): boolean {
  const trimmed = cell.replace(/^[\s\u0000-\u001f\u007f-\u009f]+/, "");
  return /^[=+\-@]/.test(trimmed) && !/^[+-]?\d+(\.\d+)?$/.test(trimmed);
}
