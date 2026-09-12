/**
 * File-name safety (PRD #29 §20-§24, §218-§224).
 *
 * Three different names come out of one upload and they are deliberately not
 * the same string:
 *
 *   originalFileName  what the user's disk called it, kept for display
 *   displayFileName   the sanitised form put in `Content-Disposition`
 *   storage key       a server-generated random id — never a human name
 *
 * That separation is the whole point. A name can carry PII, a traversal
 * sequence, a null byte or a right-to-left override; none of those can reach
 * the object store because the object store never sees the name at all
 * (PRD #29 §18, §20).
 */

/** The longest name accepted, before sanitisation (PRD #29 §24). */
export const MAX_FILE_NAME_LENGTH = 255;

/**
 * The final extension, lower-cased, with no leading dot.
 *
 * Only the *last* suffix counts. `invoice.pdf.exe` is an executable, and
 * reading anything but the final segment is how that file gets through
 * (PRD #29 §218).
 */
export function extensionOf(fileName: string): string {
  const base = baseName(fileName);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Strips every directory component, whichever separator was used. */
export function baseName(fileName: string): string {
  const segments = fileName.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] ?? "";
}

export type FileNameCheck =
  | { ok: true; displayName: string; extension: string }
  | { ok: false; reason: string };

/**
 * Validates a browser-supplied name before anything else happens to it.
 *
 * Rejection rather than repair, for the cases where quietly "fixing" the name
 * would change what the user believes they uploaded: a name that is nothing
 * but traversal, or one carrying a null byte, is a signal — not a typo
 * (PRD #29 §222, §223).
 */
export function checkFileName(rawName: string): FileNameCheck {
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return { ok: false, reason: "A file name is required." };
  }

  if (rawName.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, reason: `File names must be ${MAX_FILE_NAME_LENGTH} characters or fewer.` };
  }

  // A null byte truncates the name for anything downstream written in C.
  if (rawName.includes("\0")) {
    return { ok: false, reason: "That file name contains an invalid character." };
  }

  // Bidirectional overrides let "cv\u202Egpj.exe" render as "cv exe.jpg"
  // (PRD #29 §222).
  if (/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(rawName)) {
    return { ok: false, reason: "That file name contains an invalid character." };
  }

  const base = baseName(rawName);
  if (base.length === 0 || base === "." || base === "..") {
    return { ok: false, reason: "That file name cannot be used." };
  }

  const extension = extensionOf(base);
  if (!extension) {
    // An extensionless file has no type anybody can confirm (PRD #29 §220).
    return { ok: false, reason: "That file has no extension, so its type cannot be confirmed." };
  }

  return { ok: true, displayName: sanitizeDisplayName(base), extension };
}

/**
 * The name shown in the UI and sent in `Content-Disposition` (PRD #29 §23,
 * §196, §221).
 *
 * Unicode is preserved — a contract really can be called "Vertrag Müller.pdf"
 * — after NFC normalisation and the removal of control characters, quotes and
 * separators. The header uses the RFC 5987 `filename*` form, so UTF-8 survives
 * the trip.
 */
export function sanitizeDisplayName(fileName: string): string {
  const base = baseName(fileName).normalize("NFC");

  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return false; // control characters
      if (code >= 0x202a && code <= 0x202e) return false; // bidi overrides
      if (code >= 0x2066 && code <= 0x2069) return false;
      return !'"\\/:*?<>|'.includes(char);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_FILE_NAME_LENGTH);

  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * A `Content-Disposition` value that cannot break out of its own header
 * (PRD #29 §43, §196).
 *
 * Both forms are emitted: a plain ASCII `filename` for old clients and the
 * percent-encoded `filename*` that carries the real Unicode name.
 */
export function contentDisposition(
  mode: "inline" | "attachment",
  fileName: string,
): string {
  const safe = sanitizeDisplayName(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
