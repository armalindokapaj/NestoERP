import type { Locale } from "../config";
import { siteEn, type SiteCopy } from "./en";
import { siteSq } from "./sq";

export type { FaqItem, LegalDocument, SiteCopy } from "./en";

/** The public site's words, by language. Read it through `getSiteCopy`. */
export const siteCopy: Record<Locale, SiteCopy> = { en: siteEn, sq: siteSq };

/** Fills `{name}` in a site string; an unknown name is left visible. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * A module tab or role department in the reader's language. English reads the
 * configuration as written; another language looks the English wording up.
 */
export function configLabel(
  copy: SiteCopy,
  kind: keyof SiteCopy["configLabels"],
  english: string,
): string {
  return copy.configLabels[kind][english] ?? english;
}
