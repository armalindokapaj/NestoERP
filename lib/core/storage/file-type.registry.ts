import { StorageError } from "./storage.errors";
import { detectType } from "./magic-bytes";
import { extensionOf } from "./file-name";

/**
 * The file type registry (PRD #29 §41, §42).
 *
 * One table decides everything about a format: whether it may be uploaded at
 * all, whether it may be shown inline, whether a scanner must look at it
 * first, and which magic bytes are acceptable behind its extension.
 *
 * It is an allowlist. A format nobody has considered is refused by default,
 * which is what stops the next interesting file format from arriving before
 * anyone has decided whether it should (PRD #29 §40).
 */

export type AllowedFileType = {
  /** Registry key, also the group the Documents list filters by. */
  key: string;
  label: string;
  extensions: string[];
  /** `Content-Type` values a browser may declare for this type (PRD #29 §30). */
  declaredMimeTypes: string[];
  /**
   * What the leading bytes may say. Absent means the format has no signature
   * worth checking — plain text and DXF are genuinely undetectable, and
   * pretending otherwise would reject valid files (PRD #29 §269).
   */
  detectedMimeTypes?: string[];
  /** May be rendered inline in a browser after validation (PRD #29 §44). */
  previewable: boolean;
  /** May leave the system at all. Everything allowed here is downloadable. */
  downloadable: boolean;
  /**
   * Must pass a malware scan before becoming AVAILABLE (PRD #29 §55).
   *
   * True for every format on the allowlist. §55 says *files* must not become
   * downloadable before a scan passes, not some files, and a format exempted
   * here would be the one an attacker reached for. The flag stays per-type
   * because §42 defines it that way and a future format might genuinely not
   * need it.
   */
  scanRequired: boolean;
  /**
   * A per-type ceiling below the product default. No format sets one today;
   * the check honours it so a policy decision is a one-line change rather than
   * a new code path (PRD #29 §42).
   */
  maxBytes?: number;
};

/**
 * The V0.1 allowlist (PRD #29 §32, §37-§39).
 *
 * Deliberately absent, each for a stated reason:
 *
 *   .exe .dll .bat .sh .ps1 …  executables (§33)
 *   .html .htm .js .mjs        active content (§34)
 *   .svg                       scriptable, and there is no sanitiser (§35)
 *   .zip .rar .7z              nested scanning is a problem V0.1 does not
 *                              solve, so archives are not accepted (§36)
 *   .docm .xlsm .pptm          macro-enabled Office (§198)
 */
export const FILE_TYPES: AllowedFileType[] = [
  {
    key: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    declaredMimeTypes: ["application/pdf"],
    detectedMimeTypes: ["application/pdf"],
    previewable: true,
    downloadable: true,
    scanRequired: true,
  },
  {
    key: "image",
    label: "Image",
    extensions: ["jpg", "jpeg", "png", "webp"],
    declaredMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    detectedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    previewable: true,
    downloadable: true,
    scanRequired: true,
  },
  {
    key: "office",
    label: "Word",
    extensions: ["doc", "docx"],
    declaredMimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    // A .docx is a zip; a .doc is an OLE2 compound file.
    detectedMimeTypes: ["application/zip", "application/x-ole-storage"],
    // Office is never rendered inline without a conversion pipeline, and there
    // is none (PRD #29 §45).
    previewable: false,
    downloadable: true,
    scanRequired: true,
  },
  {
    key: "spreadsheet",
    label: "Spreadsheet",
    extensions: ["xls", "xlsx", "csv"],
    declaredMimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
      "text/plain",
    ],
    // CSV has no signature, so this type tolerates an undetectable body.
    previewable: false,
    downloadable: true,
    scanRequired: true,
  },
  {
    key: "presentation",
    label: "Presentation",
    extensions: ["ppt", "pptx"],
    declaredMimeTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    detectedMimeTypes: ["application/zip", "application/x-ole-storage"],
    previewable: false,
    downloadable: true,
    scanRequired: true,
  },
  {
    key: "text",
    label: "Text",
    extensions: ["txt"],
    declaredMimeTypes: ["text/plain"],
    previewable: false,
    downloadable: true,
    scanRequired: true,
  },
  {
    /*
     * CAD and BIM (PRD #29 §37-§39).
     *
     * Construction customers need these, MIME support for them is inconsistent
     * enough that `application/octet-stream` is the honest declared type, and
     * no browser previews them. So: stored, downloadable, never inline
     * (PRD #29 §38, §282, §283).
     */
    key: "cad",
    label: "CAD",
    extensions: ["dwg", "dxf", "ifc", "rvt", "skp"],
    declaredMimeTypes: [
      "application/octet-stream",
      "image/vnd.dwg",
      "application/acad",
      "image/vnd.dxf",
      "application/dxf",
      "model/ifc",
      "application/x-step",
      "",
    ],
    previewable: false,
    downloadable: true,
    scanRequired: true,
  },
];

/**
 * Formats named explicitly so the refusal can be specific.
 *
 * Anything absent from the allowlist is refused anyway; this list exists so a
 * user who tries to upload `setup.exe` is told that executables cannot be
 * uploaded rather than that `EXE` is unsupported (PRD #29 §33, §34, §198).
 */
const NAMED_REFUSALS: Record<string, string> = {
  exe: "Executable files cannot be uploaded.",
  dll: "Executable files cannot be uploaded.",
  msi: "Executable files cannot be uploaded.",
  bat: "Executable files cannot be uploaded.",
  cmd: "Executable files cannot be uploaded.",
  com: "Executable files cannot be uploaded.",
  scr: "Executable files cannot be uploaded.",
  jar: "Executable files cannot be uploaded.",
  apk: "Executable files cannot be uploaded.",
  dmg: "Executable files cannot be uploaded.",
  app: "Executable files cannot be uploaded.",
  sh: "Script files cannot be uploaded.",
  ps1: "Script files cannot be uploaded.",
  vbs: "Script files cannot be uploaded.",
  js: "Script files cannot be uploaded.",
  mjs: "Script files cannot be uploaded.",
  cjs: "Script files cannot be uploaded.",
  html: "Web pages cannot be uploaded.",
  htm: "Web pages cannot be uploaded.",
  xhtml: "Web pages cannot be uploaded.",
  shtml: "Web pages cannot be uploaded.",
  svg: "SVG images cannot be uploaded.",
  zip: "Archive files cannot be uploaded. Upload the files individually.",
  rar: "Archive files cannot be uploaded. Upload the files individually.",
  "7z": "Archive files cannot be uploaded. Upload the files individually.",
  tar: "Archive files cannot be uploaded. Upload the files individually.",
  gz: "Archive files cannot be uploaded. Upload the files individually.",
  docm: "Macro-enabled Office files cannot be uploaded.",
  xlsm: "Macro-enabled Office files cannot be uploaded.",
  pptm: "Macro-enabled Office files cannot be uploaded.",
  dotm: "Macro-enabled Office files cannot be uploaded.",
  xltm: "Macro-enabled Office files cannot be uploaded.",
};

const BY_EXTENSION = new Map<string, AllowedFileType>();
for (const type of FILE_TYPES) {
  for (const extension of type.extensions) BY_EXTENSION.set(extension, type);
}

export function fileTypeForExtension(extension: string | null): AllowedFileType | null {
  if (!extension) return null;
  return BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

export function fileTypeForName(fileName: string): AllowedFileType | null {
  return fileTypeForExtension(extensionOf(fileName));
}

/** The refusal message for a known-bad extension, if there is one. */
export function namedRefusal(extension: string): string | null {
  return NAMED_REFUSALS[extension.toLowerCase()] ?? null;
}

export function isPreviewableExtension(extension: string | null): boolean {
  return fileTypeForExtension(extension)?.previewable === true;
}

export function scanRequiredForExtension(extension: string | null): boolean {
  return fileTypeForExtension(extension)?.scanRequired === true;
}

/** A short label for one document row, derived from its extension. */
export function fileTypeLabel(extension: string | null): string {
  const type = fileTypeForExtension(extension);
  if (type) return type.label;
  return extension ? extension.toUpperCase() : "File";
}

export const FILE_TYPE_GROUP_KEYS = FILE_TYPES.map((type) => type.key);

export function extensionsForGroups(groups: string[]): string[] {
  return groups.flatMap((group) => FILE_TYPES.find((t) => t.key === group)?.extensions ?? []);
}

/* -------------------------------------------------------------------------- */
/* Declared metadata                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Checks what the browser says about a file, before a single byte is accepted
 * (PRD #29 §11, §217).
 *
 * Throws rather than returning a result, because there is nothing sensible for
 * a caller to do with a refusal except pass it on.
 */
export function assertDeclaredFileAllowed(input: {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  maxBytes: number;
}): AllowedFileType {
  const extension = extensionOf(input.fileName);

  if (!extension) {
    throw new StorageError(
      "FILE_TYPE_NOT_ALLOWED",
      "That file has no extension, so its type cannot be confirmed.",
    );
  }

  const refusal = namedRefusal(extension);
  if (refusal) throw new StorageError("FILE_TYPE_NOT_ALLOWED", refusal);

  const type = fileTypeForExtension(extension);
  if (!type) {
    throw new StorageError(
      "FILE_TYPE_NOT_ALLOWED",
      `${extension.toUpperCase()} files are not supported.`,
    );
  }

  const declared = normaliseMime(input.mimeType);
  if (declared && !type.declaredMimeTypes.includes(declared)) {
    throw new StorageError("FILE_TYPE_MISMATCH", "The file type does not match its extension.");
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new StorageError("INVALID_FILE_SIZE", "That file is empty.");
  }

  const ceiling = Math.min(input.maxBytes, type.maxBytes ?? Number.MAX_SAFE_INTEGER);
  if (input.sizeBytes > ceiling) {
    throw new StorageError(
      "FILE_TOO_LARGE",
      `Files must be ${Math.round(ceiling / (1024 * 1024))} MB or smaller.`,
    );
  }

  return type;
}

/** `text/csv; charset=utf-8` and `TEXT/CSV` are the same declaration. */
export function normaliseMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Detected content                                                            */
/* -------------------------------------------------------------------------- */

export type ContentVerdict =
  | { ok: true; detectedMimeType: string | null }
  | { ok: false; code: "FILE_TYPE_MISMATCH" | "FILE_TYPE_NOT_ALLOWED"; reason: string };

/**
 * Checks the stored object's leading bytes against what its name claims
 * (PRD #29 §31, §269, §270).
 *
 * Three outcomes, in order of severity:
 *
 *   dangerous content    refused whatever it is called — this is the check
 *                        that catches an executable renamed `.pdf` (§270)
 *   contradicted type    refused, because the registry knows what this format
 *                        should start with and it does not (§269)
 *   undetectable         accepted only when the registry says this format has
 *                        no signature to check (CSV, TXT, DXF)
 */
export function verifyContent(type: AllowedFileType, head: Uint8Array): ContentVerdict {
  const detected = detectType(head);

  if (detected.dangerous) {
    return {
      ok: false,
      code: "FILE_TYPE_NOT_ALLOWED",
      reason: "That file's contents are not a permitted file type.",
    };
  }

  // A format with no declared signatures is one the registry does not know how
  // to check. Accept it and record what was seen, if anything.
  if (!type.detectedMimeTypes) return { ok: true, detectedMimeType: detected.mime };

  if (detected.mime === null) {
    return {
      ok: false,
      code: "FILE_TYPE_MISMATCH",
      reason: "The file's contents do not match its name.",
    };
  }

  if (!type.detectedMimeTypes.includes(detected.mime)) {
    return {
      ok: false,
      code: "FILE_TYPE_MISMATCH",
      reason: "The file's contents do not match its name.",
    };
  }

  return { ok: true, detectedMimeType: detected.mime };
}
