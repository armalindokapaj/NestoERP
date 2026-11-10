import { describe, expect, it } from "vitest";

import { buildXlsx, crc32, sheetName, xmlSafe } from "@/lib/modules/unit-sheet/unit-sheet.xlsx";
import { readZip, sheetCells } from "./xlsx-reader";

/**
 * "Download for Google Sheets" (2026-11-10): a valid one-sheet .xlsx whose
 * numbers are numbers and whose text can never run as a formula.
 */

describe("the .xlsx file", () => {
  const file = buildXlsx({
    sheetName: "Njësitë",
    columns: [
      { header: "Unit", width: 12, text: true },
      { header: "Internal area (m²)", width: 14 },
      { header: "Bedrooms", width: 10 },
      { header: "Net area (m²) – worked out", width: 16, muted: true },
      { header: "Notes", width: 20, text: true },
    ],
    rows: [
      [{ kind: "text", text: "T-501" }, { kind: "number", value: "64.72", format: "decimal" }, { kind: "number", value: "2", format: "integer" }, { kind: "number", value: "72.72", format: "decimal" }, { kind: "text", text: '=HYPERLINK("https://evil.example","x")' }],
      [{ kind: "text", text: "0501" }, null, { kind: "number", value: "not a number", format: "integer" }, null, { kind: "text", text: " +355 <b>&amp;</b>" }],
      [{ kind: "text", text: "\u0001@SUM(A1)" }, { kind: "number", value: "1e5", format: "decimal" }, null, null, { kind: "text", text: "ok\ud800" }],
    ],
  });
  const files = readZip(file);

  it("is a ZIP of the five parts a workbook needs, every CRC right", () => {
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(files.get("[Content_Types].xml")).toContain("spreadsheetml.sheet.main+xml");
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Njësitë" sheetId="1" r:id="rId1"/>');
    // The same content gives the same bytes: entries are dated, not timestamped.
    expect(Buffer.from(buildXlsx({ sheetName: "A", columns: [{ header: "x", width: 5 }], rows: [] })).equals(Buffer.from(buildXlsx({ sheetName: "A", columns: [{ header: "x", width: 5 }], rows: [] })))).toBe(true);
  });

  it("writes numbers as numbers and text as inline strings, with the header row frozen", () => {
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    const cells = new Map(sheetCells(sheet).map((cell) => [cell.ref, cell]));
    expect(cells.get("A1")).toMatchObject({ type: "inlineStr", value: "Unit" });
    expect(cells.get("B2")).toMatchObject({ type: null, value: "64.72" });
    expect(cells.get("C2")).toMatchObject({ type: null, value: "2" });
    expect(cells.get("A3")).toMatchObject({ type: "inlineStr", value: "0501" });
    // A "number" NESTO did not produce as a plain decimal is written as text, never trusted.
    expect(cells.get("C3")).toMatchObject({ type: "inlineStr", value: "not a number" });
    expect(cells.get("B4")).toMatchObject({ type: "inlineStr", value: "1e5" });
    expect(sheet).not.toContain("<f>");
  });

  it("never lets text become a formula: inline strings, and the quote-prefix style on anything that looks like one", () => {
    const cells = new Map(sheetCells(files.get("xl/worksheets/sheet1.xml")!).map((cell) => [cell.ref, cell]));
    const quoted = /<xf [^>]*quotePrefix="1"/.exec(files.get("xl/styles.xml")!);
    expect(quoted).not.toBeNull();
    const quotedIndex = String([...files.get("xl/styles.xml")!.matchAll(/<xf [^>]*\/>/g)].slice(1).findIndex((xf) => xf[0].includes('quotePrefix="1"')));
    expect(cells.get("E2")).toMatchObject({ type: "inlineStr", style: quotedIndex, value: '=HYPERLINK("https://evil.example","x")' });
    expect(cells.get("E3")).toMatchObject({ type: "inlineStr", style: quotedIndex, value: " +355 <b>&amp;</b>" });
    expect(cells.get("A4")).toMatchObject({ type: "inlineStr", style: quotedIndex });
    // A lone surrogate and a control character are dropped: what XML cannot hold.
    expect(cells.get("E4")!.value).toBe("ok");
    expect(cells.get("A4")!.value).toBe("@SUM(A1)");
  });

  it("names its sheet as a workbook allows, and keeps XML well formed", () => {
    expect(sheetName("Units: [2026]/a*b?")).toBe("Units   2026  a b");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(xmlSafe("a\u0000b\uffffc\ud83d\ude00")).toBe("abc\ud83d\ude00");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
