/**
 * Content sniffing, done deliberately and server-side (PRD #29 §29-§31, §270).
 *
 * The browser's `Content-Type` is a claim and the extension is a claim; this
 * reads what the bytes actually start with. The two interesting answers are:
 *
 *   a type that contradicts the name   → `.pdf` holding a Word document
 *   a type that is dangerous outright  → `.pdf` holding a Windows executable
 *
 * The second is not a validation nicety. An executable renamed `.pdf` is the
 * oldest trick there is, and no extension allowlist alone catches it
 * (PRD #29 §270, §368).
 */

export type DetectedType = {
  /** The MIME type the leading bytes indicate, or null if undetectable. */
  mime: string | null;
  /**
   * True when the content is an executable, script or active-content format,
   * whatever it happens to be called. Always a rejection (PRD #29 §33, §34).
   */
  dangerous: boolean;
};

/** How many leading bytes any signature here needs. */
export const MAGIC_BYTE_WINDOW = 64;

type Signature = {
  offset: number;
  bytes: number[];
  mime: string | null;
  dangerous?: boolean;
};

const hex = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/**
 * Ordered: dangerous signatures are tested first, so a file that is both
 * plausibly an archive and actually an executable is reported as the latter.
 */
const SIGNATURES: Signature[] = [
  // Executables and object code (PRD #29 §33).
  { offset: 0, bytes: [0x4d, 0x5a], mime: "application/x-msdownload", dangerous: true }, // MZ / PE
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], mime: "application/x-elf", dangerous: true },
  { offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe], mime: "application/x-mach-binary", dangerous: true },
  { offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe], mime: "application/x-mach-binary", dangerous: true },
  { offset: 0, bytes: [0xce, 0xfa, 0xed, 0xfe], mime: "application/x-mach-binary", dangerous: true },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf], mime: "application/x-mach-binary", dangerous: true },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce], mime: "application/x-mach-binary", dangerous: true },
  // A shebang: whatever the name says, the kernel will run this.
  { offset: 0, bytes: hex("#!"), mime: "text/x-script", dangerous: true },

  // Documents and images.
  { offset: 0, bytes: hex("%PDF-"), mime: "application/pdf" },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: "image/png" },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { offset: 8, bytes: hex("WEBP"), mime: "image/webp" },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },

  // OOXML (docx/xlsx/pptx) and every other zip container share this.
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], mime: "application/zip" },
  { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06], mime: "application/zip" },
  { offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08], mime: "application/zip" },
  // Legacy Office and Revit are OLE2 compound files.
  { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], mime: "application/x-ole-storage" },

  // CAD.
  { offset: 0, bytes: hex("AC10"), mime: "image/vnd.dwg" },
  { offset: 0, bytes: hex("ISO-10303-21"), mime: "application/x-step" },
];

/** Active content that would execute if it were ever served inline (§34, §35). */
const ACTIVE_TEXT = [
  /^\s*<!doctype\s+html/i,
  /^\s*<html[\s>]/i,
  /^\s*<svg[\s>]/i,
  /^\s*<\?xml[^>]*\?>\s*<!doctype\s+svg/i,
  /^\s*<\?xml[^>]*\?>\s*<svg[\s>]/i,
  /^\s*<script[\s>]/i,
];

function matches(bytes: Uint8Array, signature: Signature): boolean {
  const end = signature.offset + signature.bytes.length;
  if (bytes.length < end) return false;
  for (let i = 0; i < signature.bytes.length; i += 1) {
    if (bytes[signature.offset + i] !== signature.bytes[i]) return false;
  }
  return true;
}

/**
 * Reads the leading bytes of an object and says what it is.
 *
 * A null `mime` means "no signature matched" — which is the correct answer for
 * plain text, CSV and DXF, and is why the registry decides separately whether
 * a type may go undetected (PRD #29 §269).
 */
export function detectType(bytes: Uint8Array): DetectedType {
  for (const signature of SIGNATURES) {
    if (matches(bytes, signature)) {
      return { mime: signature.mime, dangerous: signature.dangerous === true };
    }
  }

  // Nothing binary matched. Markup only counts as active content when it is
  // the *first* thing in the file, so a CSV mentioning `<script>` in a cell is
  // not condemned for it.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, MAGIC_BYTE_WINDOW));
  if (ACTIVE_TEXT.some((pattern) => pattern.test(head))) {
    return { mime: "text/html", dangerous: true };
  }

  return { mime: null, dangerous: false };
}
