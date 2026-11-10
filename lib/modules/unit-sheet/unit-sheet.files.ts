import type { Locale } from "@/lib/i18n/config";

/**
 * The names of the files the Units and Sales tabs hand out (2026-11-10):
 * "Download for Google Sheets" and Export. Pure, so they are unit-tested on
 * their own. Neither name holds a quote, a slash, a control character or
 * anything a file system refuses, so a Content-Disposition carries them as
 * they are.
 */

/** `RIV-units-2026-11-10.xlsx`: letters, digits, dot, dash and underscore only. */
export function sheetFilename(projectCode: string, now: Date = new Date()): string {
  const base = projectCode
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return `${base || "project"}-units-${now.toISOString().slice(0, 10)}.xlsx`;
}

/**
 * Export's file name (2026-11-10): "Riverside Residences – units – 2026-11-10.xlsx",
 * in the reader's language. `utf8` keeps letters in any script and the dash;
 * `ascii` is the same with accents dropped and anything else a dash, for the
 * plain `filename=` beside `filename*=`. Neither has a quote, a slash, a
 * control character or anything a file system refuses.
 */
export function exportFilename(projectName: string, locale: Locale, now: Date = new Date()): { utf8: string; ascii: string } {
  const word = locale === "sq" ? "njësitë" : "units";
  const date = now.toISOString().slice(0, 10);
  const name =
    projectName
      .normalize("NFC")
      .replace(/[^\p{L}\p{N} ._()-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80)
      .trim() || "project";
  const utf8 = `${name} – ${word} – ${date}.xlsx`;
  const ascii = utf8
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/–/g, "-")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-");
  return { utf8, ascii };
}
