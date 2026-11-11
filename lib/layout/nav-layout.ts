/**
 * How a person moves around Nesto (docs/ui/UI-04-navigation-layouts.md).
 *
 * - Desktop (from `lg`, 1024px): one top bar — the logo, which opens every
 *   module in a panel on the left; the company name, Home; the four Ribbon
 *   tabs, Work, Sales, Procurement and Finance, centred; then Create, Search,
 *   the bell and the account. Under it, the open tab's ribbon, which folds
 *   away to leave the bar alone. Whether it is folded is kept per browser.
 * - Phone (below `lg`): the Ribbon brought to the phone, chosen in Settings ›
 *   Appearance. The Pocket Ribbon (the default): the four tabs as the bottom
 *   bar, with This page, Units and Create floating above it. Or the Action
 *   Ribbon: Ribbon, the page's main actions, Units and Create, with the whole
 *   Ribbon as a sheet.
 *
 * Kept in cookies, like Day and Night, so the server draws the right shell on
 * the first paint and nothing swaps after hydration.
 */
export const RIBBON_COOKIE = "nesto.ribbon";

/** Whether the desktop ribbon is folded away, leaving the bar alone. Open unless folded. */
export function readRibbonFolded(value: string | undefined): boolean {
  return value === "folded";
}

export const PHONE_NAV_COOKIE = "nesto.phone-nav";
export const PHONE_NAV_CHOICES = ["pocket", "action"] as const;
export type PhoneNav = (typeof PHONE_NAV_CHOICES)[number];

export function readPhoneNav(value: string | undefined): PhoneNav {
  return value === "action" ? "action" : "pocket";
}
