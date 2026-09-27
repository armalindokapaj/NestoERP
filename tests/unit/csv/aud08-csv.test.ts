import { describe, expect, it } from "vitest";

import { contractSectionOf, CONTRACT_SECTION_VIEWS } from "@/components/contracts/export-link";
import { AccessError } from "@/lib/access/guards";
import {
  exportResponse,
  prepareExport,
  safeFilename,
  serializeRows,
  type ExportColumn,
} from "@/lib/core/export/exporter";
import { assertApplied, assertExportParams, assertExportRange, assertOwnCompany, exportSelector } from "@/lib/core/export/export-params";
import type { UserContext } from "@/lib/context/types";
import { CONTRACT_VIEWS } from "@/lib/modules/contracts/contracts/contract.schema";
import { csvCell, csvNumber, csvText, toCsv } from "@/lib/utils/csv";
import { byHeader, readCsvBytes, readCsvText, spreadsheetWouldEvaluate } from "./rfc4180";

/**
 * The CSV serializer and the shared exporter (AUD-08 §7; DT-17, DT-18).
 *
 * Every file is read back with the strict RFC 4180 reader beside this test —
 * not with `lib/utils/csv.ts`'s own parser — and every text cell is checked
 * against what a spreadsheet would evaluate on open.
 */

async function refusal(work: Promise<unknown> | (() => unknown)): Promise<AccessError> {
  try {
    await (typeof work === "function" ? work() : work);
  } catch (error) {
    if (error instanceof AccessError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/* -------------------------------------------------------------------------- */
/* DT-18: cells                                                                */
/* -------------------------------------------------------------------------- */

const ADVERSARIAL = [
  '=HYPERLINK("https://evil.test","Open")',
  "=1+1",
  "+1+1",
  "-2+3",
  "@SUM(A1)",
  "=cmd|' /C calc'!A0",
  "\t=1+1",
  "\r=1+1",
  "\n=1+1",
  "\r\n@SUM(A1)",
  " =1+1",
  " =1+1", // no-break space
  "　+1", // ideographic space
  " -1+1", // em space
  "\u0000+1",
  "\u0007bell",
  "\u0085=1", // next line (C1 control)
  "﻿=1+1", // a byte-order mark inside the cell
  "-120.50", // text that merely looks like a negative amount
  "+355 69 123 4567", // a phone number
  "-",
];

const ORDINARY = [
  "Riverside Tower",
  'Alba, "North"',
  "Line one\nline two",
  "Line one\r\nline two",
  "Çelësi & Ëmbëlsira — Shkodër",
  "שלום עולם", // right-to-left text
  "Crane 🏗️ delivery",
  "007", // leading-zero code
  "0042-A",
  "Rruga e Kavajës 12-A",
  "a=b",
  "  padded  ",
];

describe("DT-18 CSV cells keep text as text (AUD-08 §7)", () => {
  it("guards every formula start, whatever whitespace or control character hides it", () => {
    for (const value of ADVERSARIAL) {
      const cell = csvText(value);
      const [parsed] = readCsvText(`h\n${cell}`).rows;
      expect(parsed![0], JSON.stringify(value)).toBe(`'${value}`);
      expect(spreadsheetWouldEvaluate(parsed![0]!), JSON.stringify(value)).toBe(false);
    }
  });

  it("leaves ordinary text, Unicode and leading-zero codes exactly as typed, quoting only what must be", () => {
    for (const value of ORDINARY) {
      const [parsed] = readCsvText(`h\r\n${csvText(value)}`).rows;
      expect(parsed![0], JSON.stringify(value)).toBe(value);
    }
    expect(csvText("Riverside Tower")).toBe("Riverside Tower");
    expect(csvText("007")).toBe("007");
    expect(csvText('Alba, "North"')).toBe('"Alba, ""North"""');
  });

  it("writes a declared number bare, sign and all, and never trusts a non-number as one", () => {
    expect(csvNumber("-120.50")).toBe("-120.50");
    expect(csvNumber(-120.5)).toBe("-120.5");
    expect(csvNumber("0.00")).toBe("0.00");
    expect(csvCell("-120.50", "number")).toBe("-120.50");
    // Undeclared, a string is text: the same characters are guarded.
    expect(csvCell("-120.50")).toBe(`"'-120.50"`);
    expect(csvCell(-120.5)).toBe("-120.5");
    // A "number" that is not one is written as guarded text, not bare.
    expect(csvNumber("=1+1")).toBe(`"'=1+1"`);
    expect(csvNumber("-1+2")).toBe(`"'-1+2"`);
    expect(csvNumber("1,5")).toBe('"1,5"');
    expect(csvNumber(Number.NaN)).toBe("");
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvNumber(null)).toBe("");
    const [row] = readCsvText(`a,b\n${csvNumber("-120.50")},${csvNumber("1500.00")}`).rows;
    expect(row!.map(spreadsheetWouldEvaluate)).toEqual([false, false]);
  });

  it("guards a header too, and types each column by its declared kind", () => {
    const text = toCsv(["=Name", "Amount"], [["-5", "-5"], ["=x", "12.30"]], { kinds: ["text", "number"], lineBreak: "\r\n" });
    const read = readCsvText(text);
    expect(read.header).toEqual(["'=Name", "Amount"]);
    expect(read.rows).toEqual([["'-5", "-5"], ["'=x", "12.30"]]);
    expect(read.lineBreak).toBe("\r\n");
  });

  it("quotes every cell when asked, numbers included, and a quoted number is still a number to a reader", () => {
    const text = toCsv(["a", "b"], [["x", "-3.50"]], { quoteAll: true, lineBreak: "\r\n", kinds: ["text", "number"] });
    expect(text).toBe('"a","b"\r\n"x","-3.50"');
    expect(readCsvText(text).rows).toEqual([["x", "-3.50"]]);
  });
});

/* -------------------------------------------------------------------------- */
/* The exporter                                                                */
/* -------------------------------------------------------------------------- */

type Row = { id: string; name: string; amount: string | null; due: string | null; at: string; open: boolean; count: number | null };

const COLUMNS: ExportColumn<Row>[] = [
  { header: "ID", kind: "code", value: (row) => row.id },
  { header: "Name", kind: "text", value: (row) => row.name },
  { header: "Amount", kind: "decimal", value: (row) => row.amount },
  { header: "Due", kind: "date", value: (row) => row.due },
  { header: "At", kind: "datetime", value: (row) => row.at },
  { header: "Open", kind: "boolean", value: (row) => row.open },
  { header: "Count", kind: "integer", value: (row) => row.count },
];

const ROWS: Row[] = [
  { id: "007", name: "=HYPERLINK(1)", amount: "-120.50", due: "2026-03-29", at: "2026-03-29T00:30:00.000Z", open: true, count: 3 },
  { id: "008", name: "Çelësi, \"ë\"\nline", amount: null, due: "2026-10-25T00:00:00.000Z", at: "2026-10-25T01:30:00+02:00", open: false, count: null },
];

describe("the shared exporter (AUD-08 §7; DT-15, DT-17)", () => {
  it("serialises typed columns: bare decimals, YYYY-MM-DD dates, UTC instants with their zone, Yes/No", () => {
    const read = readCsvText(serializeRows(COLUMNS, ROWS));
    expect(read.lineBreak).toBe("\r\n");
    expect(byHeader(read)).toEqual([
      { ID: "007", Name: "'=HYPERLINK(1)", Amount: "-120.50", Due: "2026-03-29", At: "2026-03-29T00:30:00.000Z", Open: "Yes", Count: "3" },
      { ID: "008", Name: 'Çelësi, "ë"\nline', Amount: "", Due: "2026-10-25", At: "2026-10-24T23:30:00.000Z", Open: "No", Count: "" },
    ]);
  });

  it("reads the cap plus one, and answers a complete file with the BOM, a safe name and no shared cache", async () => {
    let asked = 0;
    const prepared = await prepareExport({
      id: "test.rows",
      filename: "../Raport \"Çelësi\"/2026.csv",
      columns: COLUMNS,
      limits: { maxRows: 5 },
      evaluatedAt: new Date("2026-09-27T10:00:00.000Z"),
      read: async (take) => {
        asked = take;
        return { rows: ROWS, total: 2 };
      },
    });
    expect(asked).toBe(6);
    const response = exportResponse(prepared);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-export-row-count")).toBe("2");
    expect(response.headers.get("x-export-evaluated-at")).toBe("2026-09-27T10:00:00.000Z");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Raport-Celesi-2026.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(prepared.byteLength).toBe(bytes.byteLength);
    const read = readCsvBytes(bytes);
    expect(read.bom).toBe(true);
    expect(read.rows.map((row) => row[0])).toEqual(["007", "008"]);
  });

  it("DT-17 refuses one row past the cap, a count past the cap, too many bytes and too long — never a partial file", async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ ...ROWS[0]!, id: `r${index}` }));
    const rows = await refusal(prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, limits: { maxRows: 5 }, read: async () => ({ rows: many }) }));
    expect(rows.status).toBe(422);
    expect(rows.message).toBe("Too many records to export. Narrow your filters to 5 records or fewer.");
    expect(rows.details).toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED", limit: 5, reason: "rows" });

    const counted = await refusal(prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, limits: { maxRows: 5 }, read: async () => ({ rows: many.slice(0, 2), total: 9 }) }));
    expect(counted.details).toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });

    const bytes = await refusal(prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, limits: { maxBytes: 100 }, read: async () => ({ rows: many }) }));
    expect(bytes.status).toBe(422);
    expect(bytes.details).toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED", reason: "bytes" });
    expect(bytes.message).toMatch(/Narrow your filters/);

    const slow = await refusal(prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, limits: { maxDurationMs: 20 }, read: () => new Promise<{ rows: Row[] }>((resolve) => setTimeout(() => resolve({ rows: many }), 500)) }));
    expect(slow.status).toBe(503);
    expect(slow.details).toMatchObject({ code: "EXPORT_TIMEOUT" });
  });

  it("refuses a read that returned fewer rows than its own count said match, unless the service refined them after reading", async () => {
    const short = await refusal(prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, read: async () => ({ rows: ROWS.slice(0, 1), total: 2 }) }));
    expect(short.details).toMatchObject({ code: "EXPORT_INCOMPLETE" });
    const refined = await prepareExport({ id: "t", filename: "t.csv", columns: COLUMNS, read: async () => ({ rows: ROWS.slice(0, 1), total: 2, refined: true }) });
    expect(refined.rowCount).toBe(1);
  });

  it("keeps the CRLF and trailing-line-break layouts the registers promise", () => {
    expect(serializeRows(COLUMNS.slice(0, 1), [ROWS[0]!], { lineBreak: "\r\n", trailingLineBreak: true })).toBe("ID\r\n007\r\n");
    expect(serializeRows(COLUMNS.slice(0, 1), [ROWS[0]!], { lineBreak: "\n" })).toBe("ID\n007");
    expect(safeFilename("")).toBe("nesto-export.csv");
    expect(safeFilename("sales-leads.csv")).toBe("sales-leads.csv");
  });
});

/* -------------------------------------------------------------------------- */
/* DT-03, DT-22: the query string                                              */
/* -------------------------------------------------------------------------- */

describe("an export's parameters are applied as written or refused (AUD-08 §3; DT-03, DT-22)", () => {
  const rules = {
    status: { kind: "enumList", allowed: ["OPEN", "CLOSED"], caseInsensitive: true },
    sort: { kind: "enum", allowed: ["name-asc", "due-asc"] },
    projectId: { kind: "id" },
    from: { kind: "date" },
    to: { kind: "date" },
    within: { kind: "int", min: 1, max: 365 },
    mine: { kind: "flag" },
    minValue: { kind: "decimal" },
  } as const;
  const check = (query: string) => () => assertExportParams(new URLSearchParams(query), rules, { selector: ["type"] });

  it("accepts what the list applies, ignores the page, and treats an empty value as no filter", () => {
    expect(check("status=open,CLOSED&sort=due-asc&projectId=project_a&from=2026-01-31&to=2026-02-01T00:00:00Z&within=30&mine=1&minValue=-10.5&page=3&limit=10&pageSize=5&type=x&status2=")).toThrow();
    expect(check("status=open,CLOSED&sort=due-asc&projectId=project_a&from=2026-01-31&to=2026-02-01T00:00:00Z&within=30&mine=1&minValue=-10.5&page=3&limit=10&pageSize=5&type=x")).not.toThrow();
    expect(check("status=&projectId=")).not.toThrow();
  });

  it("refuses an unknown key, a repeated key, and any value the list would drop", async () => {
    for (const query of ["bogus=1", "status=OPEN&status=CLOSED", "status=OPEN,CLOSD", "status=OPEN,", "sort=name-desc", "projectId=a b", "projectId=a,b", "from=2026-02-30", "from=yesterday", "within=0", "within=366", "within=1.5", "mine=yes", "minValue=1e3"]) {
      const error = await refusal(check(query));
      expect(error.status, query).toBe(422);
      expect(error.details, query).toMatchObject({ code: "EXPORT_FILTER_INVALID" });
    }
  });

  it("refuses a range that ends before it starts", async () => {
    expect(() => assertExportRange(new URLSearchParams("from=2026-05-01&to=2026-05-01"), "from", "to")).not.toThrow();
    expect((await refusal(() => assertExportRange(new URLSearchParams("from=2026-05-10&to=2026-05-01"), "from", "to"))).status).toBe(422);
  });

  it("proves the list's parser kept each filter: a fallen-back sort or a dropped status is refused", async () => {
    const params = new URLSearchParams("sort=bogus&status=OPEN,NOPE&heldOnly=0");
    expect((await refusal(() => assertApplied(params, { sort: "name-asc" }, { sort: "sort" }))).details).toMatchObject({ field: "sort" });
    expect((await refusal(() => assertApplied(params, { status: ["OPEN"] }, { status: "status" }))).details).toMatchObject({ field: "status" });
    expect(() => assertApplied(params, { heldOnly: false }, { heldOnly: "heldOnly" })).not.toThrow();
    expect(() => assertApplied(new URLSearchParams("status=open"), { status: ["OPEN"] }, { status: "status" })).not.toThrow();
  });

  it("refuses another company's id in a company workspace, and knows its own", async () => {
    const context = { companyId: "company_demo_a" } as UserContext;
    expect(() => assertOwnCompany(context, new URLSearchParams("company=company_demo_a"))).not.toThrow();
    const foreign = await refusal(() => assertOwnCompany(context, new URLSearchParams("company=company_demo_b")));
    expect(foreign.details).toMatchObject({ code: "EXPORT_COMPANY_OUT_OF_SCOPE" });
  });

  it("picks the file by a known selector only", async () => {
    expect(exportSelector(new URLSearchParams(""), "type", ["a", "b"] as const, "a")).toBe("a");
    expect(exportSelector(new URLSearchParams("type=b"), "type", ["a", "b"] as const, "a")).toBe("b");
    expect((await refusal(() => exportSelector(new URLSearchParams("type=c"), "type", ["a", "b"] as const, "a"))).status).toBe(422);
    expect((await refusal(() => exportSelector(new URLSearchParams("type=a&type=b"), "type", ["a", "b"] as const, "a"))).status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* DT-02: the section a contract list page is on                               */
/* -------------------------------------------------------------------------- */

describe("DT-02 the contracts export control sends the page's section", () => {
  it("reads the section from the path, and knows exactly the list's views", () => {
    expect([...CONTRACT_SECTION_VIEWS]).toEqual([...CONTRACT_VIEWS]);
    expect(contractSectionOf("/contracts/archived")).toBe("archived");
    expect(contractSectionOf("/contracts/active")).toBe("active");
    expect(contractSectionOf("/contracts/reports")).toBeNull();
    expect(contractSectionOf("/contracts")).toBeNull();
    expect(contractSectionOf("/sales/active")).toBeNull();
  });
});
