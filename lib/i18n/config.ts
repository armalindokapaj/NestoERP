/**
 * Interface language.
 *
 * A personal preference, like the colour scheme, and persisted the same way: a
 * cookie the server reads before it renders, so the first byte of HTML is
 * already in the reader's language and nothing flips after hydration. It is a
 * cookie rather than a column on the user because the sign-in pages have to
 * honour it too, and nobody is signed in there.
 *
 * Distinct from the company's locale in Localization settings, which is a
 * company-wide default for formats. This is which language one person reads
 * NESTO in.
 *
 * Edge- and client-safe: no server imports.
 */
export const LOCALE_COOKIE = "nesto.locale";

export const LOCALES = ["en", "sq"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself, so a reader finds theirs whatever is showing. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  sq: "Shqip",
};

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function readLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
