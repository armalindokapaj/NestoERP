import { describe, expect, it } from "vitest";

import {
  assertDeclaredFileAllowed,
  buildDerivedKey,
  buildQuarantineKey,
  buildStorageKey,
  assertKeyBelongsToCompany,
  isWellFormedKey,
  checkFileName,
  contentDisposition,
  detectType,
  extensionOf,
  fileTypeForExtension,
  fileTypeLabel,
  isPreviewableExtension,
  namedRefusal,
  sanitizeDisplayName,
  StorageError,
  verifyContent,
  DEFAULT_MAX_FILE_BYTES,
} from "@/lib/core/storage";

/**
 * File validation (PRD #29 §29-§42, §217-§224, §367, §368).
 *
 * These are the checks that stand between a browser and the object store, so
 * each one is tested for what it *refuses* rather than only what it accepts.
 */

const MB = 1024 * 1024;
const allow = (fileName: string, mimeType: string | null, sizeBytes = 4096) =>
  assertDeclaredFileAllowed({ fileName, mimeType, sizeBytes, maxBytes: DEFAULT_MAX_FILE_BYTES });

const refusal = (fileName: string, mimeType: string | null = null, sizeBytes = 4096) => {
  try {
    allow(fileName, mimeType, sizeBytes);
    return null;
  } catch (error) {
    return error instanceof StorageError ? error.storageCode : "UNKNOWN";
  }
};

describe("declared file allowlist (PRD #29 §32, §33)", () => {
  it("accepts the documented business formats", () => {
    for (const [fileName, mimeType] of [
      ["Site Report.pdf", "application/pdf"],
      ["Photo.JPG", "image/jpeg"],
      ["Plan.dwg", "application/octet-stream"],
      ["Model.ifc", "application/octet-stream"],
      ["Costs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["Notes.txt", "text/plain"],
      ["Rates.csv", "text/csv"],
    ] as const) {
      expect(() => allow(fileName, mimeType), fileName).not.toThrow();
    }
  });

  it("refuses executables and scripts (§33, §34)", () => {
    for (const fileName of ["setup.exe", "run.bat", "payload.js", "thing.sh", "app.apk", "lib.dll"]) {
      expect(refusal(fileName), fileName).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });

  /** Nested scanning is a problem V0.1 does not solve (PRD #29 §36). */
  it("refuses archives", () => {
    for (const fileName of ["bundle.zip", "pack.rar", "old.7z", "logs.tar"]) {
      expect(refusal(fileName), fileName).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });

  it("refuses macro-enabled Office files (§198)", () => {
    for (const fileName of ["budget.xlsm", "brief.docm", "deck.pptm"]) {
      expect(refusal(fileName), fileName).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });

  it("refuses HTML and SVG (§34, §35)", () => {
    for (const fileName of ["page.html", "logo.svg", "doc.xhtml"]) {
      expect(refusal(fileName), fileName).toBe("FILE_TYPE_NOT_ALLOWED");
    }
  });

  it("names the reason, so a user is not told EXE is 'unsupported'", () => {
    expect(namedRefusal("exe")).toMatch(/executable/i);
    expect(namedRefusal("zip")).toMatch(/archive/i);
    expect(namedRefusal("pdf")).toBeNull();
  });

  it("refuses a file with no extension (§220)", () => {
    expect(refusal("README")).toBe("FILE_TYPE_NOT_ALLOWED");
  });

  /**
   * Only the final suffix counts. Reading anything earlier is how
   * `invoice.pdf.exe` gets through (PRD #29 §218).
   */
  it("reads only the final extension", () => {
    expect(extensionOf("invoice.pdf.exe")).toBe("exe");
    expect(refusal("invoice.pdf.exe")).toBe("FILE_TYPE_NOT_ALLOWED");
  });

  it("refuses a declared type that disagrees with the extension (§219)", () => {
    expect(refusal("invoice.pdf", "text/html")).toBe("FILE_TYPE_MISMATCH");
  });

  it("refuses an empty file and one over the ceiling (§25, §27)", () => {
    expect(refusal("a.pdf", "application/pdf", 0)).toBe("INVALID_FILE_SIZE");
    expect(refusal("a.pdf", "application/pdf", 500 * MB)).toBe("FILE_TOO_LARGE");
  });

  it("carries the registry's policy for each type (§42)", () => {
    expect(fileTypeForExtension("pdf")?.previewable).toBe(true);
    // Office never renders inline without a conversion pipeline (§45).
    expect(fileTypeForExtension("docx")?.previewable).toBe(false);
    // CAD is stored and downloadable, never previewed (§38, §282).
    expect(fileTypeForExtension("dwg")?.downloadable).toBe(true);
    expect(fileTypeForExtension("dwg")?.previewable).toBe(false);
    // Every allowed format is scanned when a scanner exists (§55).
    for (const extension of ["pdf", "png", "docx", "xlsx", "txt", "csv", "dwg"]) {
      expect(fileTypeForExtension(extension)?.scanRequired, extension).toBe(true);
    }
  });
});

describe("file names (PRD #29 §23, §24, §221-§224, §367)", () => {
  it("accepts a normal name and reports its extension", () => {
    const result = checkFileName("Structural Drawings rev C.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extension).toBe("pdf");
      expect(result.displayName).toBe("Structural Drawings rev C.pdf");
    }
  });

  it("keeps Unicode, because a real contract really is called that (§221)", () => {
    expect(sanitizeDisplayName("Vertrag Müller 2026.pdf")).toBe("Vertrag Müller 2026.pdf");
    expect(sanitizeDisplayName("Kontratë ndërtimi.pdf")).toBe(
      "Kontratë ndërtimi.pdf",
    );
  });

  it("strips path separators and traversal (§223)", () => {
    expect(sanitizeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayName("..\\windows\\system32\\cmd.txt")).toBe("cmd.txt");
    expect(sanitizeDisplayName("/absolute/path/report.pdf")).toBe("report.pdf");
  });

  /** A null byte truncates the name for anything downstream written in C. */
  it("refuses a null byte", () => {
    expect(checkFileName("invoice\u0000.exe").ok).toBe(false);
  });

  /**
   * A right-to-left override makes "cv<RLO>gpj.exe" render as "cv exe.jpg".
   * The extension check would pass; the user would be reading a lie (§222).
   */
  it("refuses a bidirectional override", () => {
    expect(checkFileName("cv\u202Egpj.exe").ok).toBe(false);
    expect(sanitizeDisplayName("cv\u202Egpj.pdf")).toBe("cvgpj.pdf");
  });

  it("refuses a name that is nothing but traversal", () => {
    expect(checkFileName("..").ok).toBe(false);
    expect(checkFileName("").ok).toBe(false);
  });

  it("bounds the length at 255 (§24)", () => {
    expect(checkFileName(`${"a".repeat(300)}.pdf`).ok).toBe(false);
  });

  /** A name must not be able to break out of its own header (§196). */
  it("builds a Content-Disposition that cannot be escaped", () => {
    const header = contentDisposition("attachment", 'evil"; drop=1.pdf');
    expect(header).not.toContain('"; drop=1');
    expect(header).toContain("filename*=UTF-8''");
  });

  it("carries Unicode through the header in the RFC 5987 form", () => {
    const header = contentDisposition("inline", "Raporë.pdf");
    expect(header).toContain("filename*=UTF-8''Rapor%C3%AB.pdf");
  });
});

describe("content detection (PRD #29 §31, §270, §368)", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (value: string) => new TextEncoder().encode(value);

  it("recognises the formats it stores", () => {
    expect(detectType(text("%PDF-1.7")).mime).toBe("application/pdf");
    expect(detectType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).mime).toBe("image/png");
    expect(detectType(bytes(0xff, 0xd8, 0xff, 0xe0)).mime).toBe("image/jpeg");
    expect(detectType(bytes(0x50, 0x4b, 0x03, 0x04)).mime).toBe("application/zip");
  });

  it("flags executables whatever they are called (§270)", () => {
    for (const head of [
      bytes(0x4d, 0x5a, 0x90, 0x00), // Windows PE
      bytes(0x7f, 0x45, 0x4c, 0x46), // ELF
      bytes(0xcf, 0xfa, 0xed, 0xfe), // Mach-O
      text("#!/bin/sh\necho hi"), // shebang
    ]) {
      expect(detectType(head).dangerous).toBe(true);
    }
  });

  it("flags active markup (§34, §35)", () => {
    expect(detectType(text("<!DOCTYPE html><html>")).dangerous).toBe(true);
    expect(detectType(text('<svg xmlns="http://www.w3.org/2000/svg">')).dangerous).toBe(true);
  });

  /** A CSV that mentions a script tag in a cell is not condemned for it. */
  it("only treats markup at the start of the file as active content", () => {
    expect(detectType(text("name,note\nAcme,<script>alert(1)</script>\n")).dangerous).toBe(false);
  });

  it("returns nothing for genuinely undetectable content", () => {
    expect(detectType(text("date,amount\n2026-01-01,100\n")).mime).toBeNull();
  });
});

describe("content verification against the registry (PRD #29 §269, §368)", () => {
  const pdf = fileTypeForExtension("pdf")!;
  const csv = fileTypeForExtension("csv")!;
  const head = (value: string) => new TextEncoder().encode(value);

  it("accepts content that matches the name", () => {
    const verdict = verifyContent(pdf, head("%PDF-1.4\n"));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.detectedMimeType).toBe("application/pdf");
  });

  it("refuses an executable renamed .pdf — the whole point of the check", () => {
    const verdict = verifyContent(pdf, new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("FILE_TYPE_NOT_ALLOWED");
  });

  it("refuses HTML renamed .pdf", () => {
    const verdict = verifyContent(pdf, head("<html><body>hello"));
    expect(verdict.ok).toBe(false);
  });

  it("refuses a Word document wearing a .pdf name (§269)", () => {
    const verdict = verifyContent(pdf, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("FILE_TYPE_MISMATCH");
  });

  /** CSV has no signature, so the registry lets it through undetected. */
  it("accepts an undetectable body for a format with no signature", () => {
    const verdict = verifyContent(csv, head("date,amount\n2026-01-01,100\n"));
    expect(verdict.ok).toBe(true);
  });

  it("still refuses dangerous content in a signature-free format", () => {
    const verdict = verifyContent(csv, head("#!/bin/sh\nrm -rf /"));
    expect(verdict.ok).toBe(false);
  });
});

describe("storage keys (PRD #29 §19, §20, §365)", () => {
  it("puts the company first, so one tenant cannot address another's space", () => {
    const key = buildStorageKey({ companyId: "company_a", documentId: "doc_1", extension: "pdf" });
    expect(key).toMatch(/^companies\/company_a\/documents\/doc_1\/[0-9a-f]{32}\.pdf$/);
  });

  /** The user's file name is nowhere in the key (PRD #29 §20). */
  it("never contains the uploaded file name", () => {
    const key = buildStorageKey({ companyId: "c1", documentId: "d1", extension: "pdf" });
    expect(key).not.toContain("Report");
    expect(key).not.toContain(" ");
  });

  it("gives every upload its own key, so an object is never overwritten (§179)", () => {
    const a = buildStorageKey({ companyId: "c1", documentId: "d1", extension: "pdf" });
    const b = buildStorageKey({ companyId: "c1", documentId: "d1", extension: "pdf" });
    expect(a).not.toBe(b);
  });

  it("keeps derived objects under the original's prefix (§237)", () => {
    expect(
      buildDerivedKey({ companyId: "c1", documentId: "d1", kind: "thumb", extension: "webp" }),
    ).toBe("companies/c1/documents/d1/derived/thumb.webp");
  });

  it("keeps quarantine out of the business key space (§62)", () => {
    expect(buildQuarantineKey({ companyId: "c1", documentId: "d1" })).toMatch(
      /^quarantine\/c1\/d1\/[0-9a-f]{32}$/,
    );
  });

  it("refuses a key outside the company's prefix", () => {
    expect(() =>
      assertKeyBelongsToCompany("companies/company_b/documents/d/x", "company_a"),
    ).toThrow();
    expect(() =>
      assertKeyBelongsToCompany("companies/company_a/documents/d/x", "company_a"),
    ).not.toThrow();
  });

  it("rejects malformed keys", () => {
    expect(isWellFormedKey("companies/a/documents/b/c.pdf")).toBe(true);
    expect(isWellFormedKey("../etc/passwd")).toBe(false);
    expect(isWellFormedKey("/absolute")).toBe(false);
    expect(isWellFormedKey("a\\b")).toBe(false);
  });
});

describe("presentation", () => {
  it("labels a type by its registry group", () => {
    expect(fileTypeLabel("xlsx")).toBe("Spreadsheet");
    expect(fileTypeLabel("dwg")).toBe("CAD");
    expect(fileTypeLabel(null)).toBe("File");
  });

  it("previews only formats that cannot execute (§44)", () => {
    expect(isPreviewableExtension("pdf")).toBe(true);
    expect(isPreviewableExtension("png")).toBe(true);
    expect(isPreviewableExtension("docx")).toBe(false);
    expect(isPreviewableExtension("dwg")).toBe(false);
  });
});
