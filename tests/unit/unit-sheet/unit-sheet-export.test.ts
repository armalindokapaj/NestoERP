import { describe, expect, it } from "vitest";

import { columnOfHeader, IGNORED_COLUMNS, isReadOnlyColumn, SHEET_COLUMNS, SHEET_HEADERS, WORKED_OUT_COLUMNS } from "@/lib/modules/unit-sheet/unit-sheet.columns";
import { diffSheet } from "@/lib/modules/unit-sheet/unit-sheet.diff";
import { exportFilename, sheetFilename } from "@/lib/modules/unit-sheet/unit-sheet.files";
import { grid, input } from "./sheet-fixtures";

/**
 * Export (2026-11-10): the Units and Sales tabs' file, written by the same
 * builder and in the same columns as "Download for Google Sheets", plus a
 * Status column the sheet never sets — so an exported file can be imported
 * into a sheet and linked without Status being listed as unknown or read.
 */

const DAY = new Date("2026-11-10T08:00:00.000Z");

describe("the Status column", () => {
  it("is known in English and Albanian, last of the columns, and never read", () => {
    expect(SHEET_COLUMNS.at(-1)).toBe("status");
    expect(columnOfHeader(SHEET_HEADERS.status.en)).toBe("status");
    expect(columnOfHeader(SHEET_HEADERS.status.sq)).toBe("status");
    expect(columnOfHeader("  STATUSI ")).toBe("status");
    expect(IGNORED_COLUMNS.has("status")).toBe(true);
    expect(isReadOnlyColumn("status")).toBe(true);
    expect(isReadOnlyColumn("netArea")).toBe(true);
    expect(isReadOnlyColumn("bedrooms")).toBe(false);
    expect(WORKED_OUT_COLUMNS.has("status")).toBe(false);
  });

  it("in a sheet made from an export is not an unknown column, is shown as read only, and changes nothing", () => {
    const diff = diffSheet(input(grid(["Unit", "Bedrooms", "Status"], [["T-501", 2, "Sold"], ["T-502", 1, "Available"]])));
    expect(diff.check.unknownColumns).toEqual([]);
    expect(diff.check.columns.find((column) => column.key === "status")).toMatchObject({ column: "C", header: "Status", readOnly: true });
    expect(diff.skipped).toEqual([]);
    // Bedrooms agree with NESTO; Status is not a field, so it is never compared.
    expect(diff.matched.flatMap((matched) => matched.outcomes)).toEqual([
      { kind: "agree", field: "bedrooms" },
      { kind: "agree", field: "bedrooms" },
    ]);
  });

  it("says nothing about whether a row is empty: a row with only a status is no row", () => {
    const diff = diffSheet(input(grid(["Njësia", "Statusi"], [["T-501", "I shitur"], [null, "Në shitje"]])));
    expect(diff.skipped).toEqual([]);
    expect(diff.check.rows).toBe(2);
  });
});

describe("file names", () => {
  it("Export: the project's name, the word in the reader's language and the day, with an ASCII twin", () => {
    expect(exportFilename("Riverside Residences", "en", DAY)).toEqual({ utf8: "Riverside Residences – units – 2026-11-10.xlsx", ascii: "Riverside Residences - units - 2026-11-10.xlsx" });
    expect(exportFilename("Kulla e Lirisë", "sq", DAY)).toEqual({ utf8: "Kulla e Lirisë – njësitë – 2026-11-10.xlsx", ascii: "Kulla e Lirise - njesite - 2026-11-10.xlsx" });
  });

  it("Export: never a quote, a slash, a control character or a leading dot, and a name with nothing left is 'project'", () => {
    const { utf8, ascii } = exportFilename('../"Tower"\\\n<A>/B‮', "en", DAY);
    for (const name of [utf8, ascii]) {
      expect(name).not.toMatch(/["\\/\n<>\u0000-\u001f‮]/);
      expect(name.startsWith(".")).toBe(false);
    }
    expect(utf8).toBe("Tower A B – units – 2026-11-10.xlsx");
    expect(exportFilename("///", "en", DAY).utf8).toBe("project – units – 2026-11-10.xlsx");
    expect(exportFilename("x".repeat(200), "en", DAY).utf8.length).toBeLessThan(110);
  });

  it("Download for Google Sheets: the project's code, letters, digits, dot, dash and underscore only", () => {
    expect(sheetFilename("A-PRJ-001", DAY)).toBe("A-PRJ-001-units-2026-11-10.xlsx");
    expect(sheetFilename("Ç/Ë 7", DAY)).toBe("C-E-7-units-2026-11-10.xlsx");
    expect(sheetFilename("", DAY)).toBe("project-units-2026-11-10.xlsx");
  });
});

describe("the words the Units and Sales tabs use for a sync", () => {
  it("name every skip reason and every field, in English and Albanian", async () => {
    const { SHEET_FIELDS, SHEET_SKIP_REASONS } = await import("@/lib/modules/unit-sheet/unit-sheet.types");
    const { projectsEn } = await import("@/lib/i18n/modules/projects/en");
    const { projectsSq } = await import("@/lib/i18n/modules/projects/sq");
    for (const words of [projectsEn, projectsSq]) {
      const reasons = words.unitSheet.reason as Record<string, string>;
      for (const reason of SHEET_SKIP_REASONS) expect(reasons[reason], reason).toBeTruthy();
      const labels: Record<string, string> = { ...words.area, ...words.count, ...words.unitSheet.field };
      for (const field of SHEET_FIELDS) expect(labels[field], field).toBeTruthy();
    }
  });
});
