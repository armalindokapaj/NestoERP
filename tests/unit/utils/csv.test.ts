import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "@/lib/utils/csv";

describe("CSV export cells (PRD #47 §69)", () => {
  it("neutralises cells a spreadsheet would evaluate as a formula", () => {
    expect(csvCell('=HYPERLINK("https://evil.test","Open")')).toBe(`"'=HYPERLINK(""https://evil.test"",""Open"")"`);
    expect(csvCell("+1+1")).toBe(`"'+1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("\tcmd")).toBe(`"'\tcmd"`);
  });

  it("finds a formula behind leading spaces and control characters (AUD-01 §8)", () => {
    expect(csvCell(" =1+1")).toBe(`"' =1+1"`);
    expect(csvCell("\n=cmd")).toBe(`"'\n=cmd"`);
    expect(csvCell("\r\n@SUM(A1)")).toBe(`"'\r\n@SUM(A1)"`);
    expect(csvCell("\u0000+1")).toBe(`"'\u0000+1"`);
    expect(csvCell("\u0007bell")).toBe(`"'\u0007bell"`);
    // Text that merely contains a formula character later on is left alone.
    expect(csvCell("Rruga e Kavajës 12-A")).toBe("Rruga e Kavajës 12-A");
    expect(csvCell("Line one\n=not a start")).toBe(`"Line one\n=not a start"`);
  });

  it("keeps numbers, negative amounts and ordinary text as they are", () => {
    expect(csvCell(-120.5)).toBe("-120.5");
    // Declared numeric output stays a number; number-like text is text (AUD-08 §7, DT-18).
    expect(csvCell("-120.50", "number")).toBe("-120.50");
    expect(csvCell("-120.50")).toBe(`"'-120.50"`);
    expect(csvCell("Riverside Tower")).toBe("Riverside Tower");
    expect(csvCell(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Alba, "North"')).toBe('"Alba, ""North"""');
    expect(toCsv(["a", "b"], [["x", "y,z"]])).toBe('a,b\nx,"y,z"');
    expect(toCsv(["a"], [["x"]], { quoteAll: true, lineBreak: "\r\n" })).toBe('"a"\r\n"x"');
  });
});
