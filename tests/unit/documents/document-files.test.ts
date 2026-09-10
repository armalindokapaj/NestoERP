import { describe, expect, it } from "vitest";

import {
  checkFile,
  extensionOf,
  fileTypeLabel,
  formatFileSize,
  isPreviewable,
  sanitizeFileName,
} from "@/lib/modules/documents/document.files";
import { buildStorageKey } from "@/lib/storage";

/**
 * File rules (PRD #13 §25–§31, §154, §157, §235).
 *
 * The allowlist and the name sanitiser are the two places a document upload
 * would go wrong quietly, so both are covered exhaustively.
 */
describe("allowlist (PRD #13 §27, §28)", () => {
  const size = 1024;

  it("accepts the documented formats", () => {
    for (const [fileName, mimeType] of [
      ["Site Report.pdf", "application/pdf"],
      ["Photo.JPG", "image/jpeg"],
      ["Plan.dwg", "application/octet-stream"],
      ["Costs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["Notes.txt", "text/plain"],
    ] as const) {
      expect(checkFile({ fileName, mimeType, sizeBytes: size }).ok, fileName).toBe(true);
    }
  });

  it("refuses executables and scripts", () => {
    for (const fileName of ["setup.exe", "run.bat", "payload.js", "thing.sh", "app.apk"]) {
      const result = checkFile({ fileName, mimeType: null, sizeBytes: size });
      expect(result.ok, fileName).toBe(false);
    }
  });

  /** No malware scanning exists, so macros do not come in (PRD #13 §29, §33). */
  it("refuses macro-enabled Office files", () => {
    for (const fileName of ["budget.xlsm", "brief.docm", "deck.pptm"]) {
      expect(checkFile({ fileName, mimeType: null, sizeBytes: size }).ok, fileName).toBe(false);
    }
  });

  /** These would execute in the browser if ever served inline (PRD #13 §157). */
  it("refuses HTML and SVG", () => {
    for (const fileName of ["page.html", "logo.svg", "doc.xhtml"]) {
      expect(checkFile({ fileName, mimeType: null, sizeBytes: size }).ok, fileName).toBe(false);
    }
  });

  it("refuses a file with no extension", () => {
    expect(checkFile({ fileName: "README", mimeType: null, sizeBytes: size }).ok).toBe(false);
  });

  /** Either alone is easy to lie about; the pair has to agree (PRD #13 §26). */
  it("refuses a MIME type that disagrees with the extension", () => {
    const result = checkFile({
      fileName: "invoice.pdf",
      mimeType: "text/html",
      sizeBytes: size,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an empty file and one over the ceiling", () => {
    expect(checkFile({ fileName: "a.pdf", mimeType: null, sizeBytes: 0 }).ok).toBe(false);

    const tooBig = checkFile({
      fileName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 500 * 1024 * 1024,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.code).toBe("FILE_TOO_LARGE");
  });
});

describe("name sanitisation (PRD #13 §154, §155)", () => {
  it("strips path separators and traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\\\windows\\\\system32\\\\cmd.txt")).toBe("cmd.txt");
    expect(sanitizeFileName("/absolute/path/report.pdf")).toBe("report.pdf");
  });

  it("folds spaces and unsafe characters into hyphens", () => {
    expect(sanitizeFileName("Site Report — Week 32.pdf")).toBe("Site-Report-Week-32.pdf");
    expect(sanitizeFileName("a??b*c.pdf")).toBe("a-b-c.pdf");
  });

  it("never returns an empty name", () => {
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("bounds the length", () => {
    expect(sanitizeFileName(`${"a".repeat(400)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe("storage keys (PRD #13 §16)", () => {
  it("puts the company first, so one tenant cannot address another's space", () => {
    expect(buildStorageKey("company_a", "doc_1", "report.pdf")).toBe(
      "companies/company_a/documents/doc_1/report.pdf",
    );
  });
});

describe("presentation helpers", () => {
  it("derives an extension case-insensitively", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("no-extension")).toBe("");
  });

  it("labels a type by group", () => {
    expect(fileTypeLabel("xlsx")).toBe("Spreadsheet");
    expect(fileTypeLabel("dwg")).toBe("CAD");
    expect(fileTypeLabel(null)).toBe("File");
  });

  /** Only formats that cannot execute in the browser (PRD #13 §34, §157). */
  it("previews only safe formats", () => {
    expect(isPreviewable("pdf")).toBe(true);
    expect(isPreviewable("png")).toBe(true);
    expect(isPreviewable("docx")).toBe(false);
    expect(isPreviewable("zip")).toBe(false);
  });

  it("formats sizes for people", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(842 * 1024)).toBe("842 KB");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatFileSize(null)).toBe("—");
  });
});
