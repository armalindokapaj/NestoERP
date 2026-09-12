import { describe, expect, it } from "vitest";

import {
  extensionsForGroups,
  fileTypeGroupLabels,
  FILE_TYPE_GROUPS,
  fileTypeLabel,
  formatFileSize,
  isPreviewable,
} from "@/lib/modules/documents/document.files";

/**
 * The Documents module's presentation of file types (PRD #13 §78, §170, §171).
 *
 * The rules themselves — the allowlist, name sanitisation, magic bytes,
 * storage keys — moved to `lib/core/storage` when PRD #29 made them a platform
 * concern, and are covered by `tests/unit/storage/file-rules.test.ts`. What
 * remains here is what the list filter and the table actually render.
 */
describe("file type groups (PRD #13 §78)", () => {
  it("offers a group for every type the registry accepts", () => {
    expect(Object.keys(FILE_TYPE_GROUPS)).toEqual(
      expect.arrayContaining(["pdf", "image", "office", "spreadsheet", "cad"]),
    );
  });

  it("gives each group a readable label, never a raw key", () => {
    for (const key of Object.keys(FILE_TYPE_GROUPS)) {
      expect(fileTypeGroupLabels[key], key).toBeTruthy();
      expect(fileTypeGroupLabels[key]).not.toBe(key);
    }
  });

  it("expands a group filter to the extensions it covers", () => {
    expect(extensionsForGroups(["image"]).sort()).toEqual(["jpeg", "jpg", "png", "webp"]);
    expect(extensionsForGroups(["pdf", "text"]).sort()).toEqual(["pdf", "txt"]);
  });

  /** Archives left the allowlist under PRD #29 §36, so no group offers them. */
  it("no longer offers an archive group", () => {
    expect(Object.keys(FILE_TYPE_GROUPS)).not.toContain("archive");
    expect(extensionsForGroups(["archive"])).toEqual([]);
  });
});

describe("presentation helpers", () => {
  it("labels a type by group", () => {
    expect(fileTypeLabel("xlsx")).toBe("Spreadsheet");
    expect(fileTypeLabel("dwg")).toBe("CAD");
    expect(fileTypeLabel(null)).toBe("File");
  });

  it("previews only safe formats (PRD #29 §44)", () => {
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

  /** Sizes arrive from the API as strings, because BigInt has no JSON form. */
  it("accepts a size that arrived as a string (PRD #29 §350)", () => {
    expect(formatFileSize("1048576")).toBe("1.0 MB");
  });
});
