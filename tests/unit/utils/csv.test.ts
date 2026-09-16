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

  it("keeps numbers, negative amounts and ordinary text as they are", () => {
    expect(csvCell(-120.5)).toBe("-120.5");
    expect(csvCell("-120.50")).toBe("-120.50");
    expect(csvCell("Riverside Tower")).toBe("Riverside Tower");
    expect(csvCell(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Alba, "North"')).toBe('"Alba, ""North"""');
    expect(toCsv(["a", "b"], [["x", "y,z"]])).toBe('a,b\nx,"y,z"');
    expect(toCsv(["a"], [["x"]], { quoteAll: true, lineBreak: "\r\n" })).toBe('"a"\r\n"x"');
  });
});
