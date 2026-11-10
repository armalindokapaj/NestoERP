/**
 * Day or Night — the Nesto theme's two colour schemes (design spec §85, §86;
 * docs/ui/UI-03-nesto-theme.md §1).
 *
 * Persisted in a cookie rather than localStorage for the same reason as the
 * sidebar: the server renders the attribute in the first byte of HTML, so the
 * page never paints one scheme and then flips to the other. Day is the
 * default; anything but "dark" in the cookie reads as Day.
 */
export const THEME_COOKIE = "nesto.theme";

/** Day and Night, in the order the setting offers them. */
export const THEME_CHOICES = ["light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function readThemeChoice(value: string | undefined): ThemeChoice {
  return value === "dark" ? "dark" : "light";
}
