/**
 * Colour scheme preference (design spec §85, §86).
 *
 * Persisted in a cookie rather than localStorage for the same reason as the
 * sidebar: the server renders the attribute in the first byte of HTML, so the
 * page never paints one scheme and then flips to the other.
 *
 * "system" is the default and stores no attribute at all — `color-scheme:
 * light dark` in styles/tokens.css then follows the operating system. The two
 * explicit values pin the scheme in either direction.
 */
export const THEME_COOKIE = "nesto.theme";

export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice);
}

export function readThemeChoice(value: string | undefined): ThemeChoice {
  return isThemeChoice(value) ? value : "system";
}

/**
 * The value for the `data-theme` attribute on <html>. "system" deliberately
 * renders nothing, so only `prefers-color-scheme` decides.
 */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}
