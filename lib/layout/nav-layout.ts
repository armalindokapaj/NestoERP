/**
 * How a person moves around Nesto: one navigation layout on a desktop and one
 * on a phone, each chosen in Settings › Appearance
 * (docs/ui/UI-04-navigation-layouts.md).
 *
 * - Desktop (from `lg`, 1024px): the Ribbon, Office-style tabs under the top
 *   bar (the default), or the Dock, a bar of tabs at the bottom that each open
 *   their own menu.
 * - Phone (below `lg`): the Thumb bar — Home, Projects, Create, Alerts, Menu —
 *   (the default), or Bottom tabs, where each tab opens its own menu.
 *
 * Kept in cookies, like Day and Night, so the server draws the chosen layout on
 * the first paint and nothing swaps after hydration.
 */
export const DESKTOP_NAV_COOKIE = "nesto.desktop-nav";
export const DESKTOP_NAV_CHOICES = ["ribbon", "dock"] as const;
export type DesktopNav = (typeof DESKTOP_NAV_CHOICES)[number];

export function readDesktopNav(value: string | undefined): DesktopNav {
  return value === "dock" ? "dock" : "ribbon";
}

export const PHONE_NAV_COOKIE = "nesto.phone-nav";
export const PHONE_NAV_CHOICES = ["thumb", "tabs"] as const;
export type PhoneNav = (typeof PHONE_NAV_CHOICES)[number];

export function readPhoneNav(value: string | undefined): PhoneNav {
  return value === "tabs" ? "tabs" : "thumb";
}
