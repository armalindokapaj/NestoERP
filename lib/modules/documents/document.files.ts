import path from "node:path";

/**
 * File-type, size and name rules (PRD #13 §25–§31, §154, §157).
 *
 * An allowlist rather than a blocklist: anything not named here is refused, so
 * a format nobody considered cannot arrive by default.
 */

/** Extension → the MIME types accepted for it (PRD #13 §26, §27). */
const ALLOWED: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/csv", "text/plain"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  dwg: ["image/vnd.dwg", "application/acad", "application/octet-stream"],
  dxf: ["image/vnd.dxf", "application/dxf", "application/octet-stream"],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
};

/**
 * Refused outright, and named so the refusal can be specific.
 *
 * Executables and scripts (PRD #13 §28), macro-enabled Office files while
 * there is no malware scanning (PRD #13 §29), and HTML/SVG, which would
 * execute in the browser if they were ever served inline (PRD #13 §157).
 */
const BLOCKED = new Set([
  "exe", "msi", "bat", "cmd", "com", "ps1", "sh", "js", "mjs", "cjs", "vbs",
  "apk", "dmg", "app", "jar", "scr",
  "docm", "xlsm", "pptm", "dotm", "xltm",
  "html", "htm", "svg", "xhtml", "shtml",
]);

export const MAX_UPLOAD_BYTES = readMaxBytes();

function readMaxBytes(): number {
  const configured = Number.parseInt(process.env.DOCUMENT_MAX_UPLOAD_MB ?? "", 10);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : 100;
  return megabytes * 1024 * 1024;
}

export function maxUploadMegabytes(): number {
  return Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
}

export type FileCheck =
  | { ok: true; extension: string }
  | { ok: false; code: "UNSUPPORTED_FILE_TYPE" | "FILE_TOO_LARGE"; message: string };

export function extensionOf(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").toLowerCase();
}

/**
 * Validates a declared file before anything is stored.
 *
 * The browser's MIME type is checked against the extension rather than trusted
 * on its own: either alone is easy to lie about, and the pair has to agree
 * (PRD #13 §25, §26).
 */
export function checkFile(input: {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
}): FileCheck {
  const extension = extensionOf(input.fileName);

  if (!extension) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "That file has no extension, so its type cannot be confirmed.",
    };
  }

  if (BLOCKED.has(extension)) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: `${extension.toUpperCase()} files cannot be uploaded.`,
    };
  }

  const allowedTypes = ALLOWED[extension];
  if (!allowedTypes) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: `${extension.toUpperCase()} files are not supported.`,
    };
  }

  const declared = (input.mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (declared && !allowedTypes.includes(declared)) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "The file type does not match its extension.",
    };
  }

  if (input.sizeBytes <= 0) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "That file is empty." };
  }

  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Files must be ${maxUploadMegabytes()} MB or smaller.`,
    };
  }

  return { ok: true, extension };
}

/**
 * A storage-safe file name (PRD #13 §154, §155).
 *
 * Path separators, traversal segments and control characters are removed
 * rather than escaped, and the result is length-bounded. The original name is
 * stored separately for display, so nothing is lost by being strict here.
 */
export function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/\\/g, "/").split("/").pop() ?? "file";

  // Anything that is not a safe key character becomes a hyphen, which covers
  // separators, spaces and control characters in one pass.
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : "file";
}

/** User-facing type groups used by the list filter (PRD #13 §78, §170). */
export const FILE_TYPE_GROUPS = {
  pdf: ["pdf"],
  office: ["doc", "docx"],
  spreadsheet: ["xls", "xlsx", "csv"],
  presentation: ["ppt", "pptx"],
  image: ["jpg", "jpeg", "png", "webp"],
  cad: ["dwg", "dxf"],
  archive: ["zip"],
  text: ["txt"],
} as const;

export type FileTypeGroup = keyof typeof FILE_TYPE_GROUPS;

export const fileTypeGroupLabels: Record<FileTypeGroup, string> = {
  pdf: "PDF",
  office: "Word",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  image: "Image",
  cad: "CAD",
  archive: "Archive",
  text: "Text",
};

export function extensionsForGroups(groups: FileTypeGroup[]): string[] {
  return groups.flatMap((group) => [...FILE_TYPE_GROUPS[group]]);
}

/** A short label for one document row, derived from its extension. */
export function fileTypeLabel(extension: string | null): string {
  if (!extension) return "File";
  for (const [group, extensions] of Object.entries(FILE_TYPE_GROUPS)) {
    if ((extensions as readonly string[]).includes(extension)) {
      return fileTypeGroupLabels[group as FileTypeGroup];
    }
  }
  return extension.toUpperCase();
}

/** Human-readable size (PRD #13 §171). Bytes are what is stored. */
export function formatFileSize(bytes: number | bigint | null): string {
  if (bytes === null) return "—";
  const value = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extensions that may be shown inline rather than downloaded (PRD #13 §34). */
const PREVIEWABLE = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export function isPreviewable(extension: string | null): boolean {
  return extension !== null && PREVIEWABLE.has(extension);
}
