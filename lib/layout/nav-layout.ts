/**
 * How a person moves around Nesto (docs/ui/UI-04-navigation-layouts.md).
 *
 * - Desktop (from `lg`, 1024px): one top bar — the logo, which opens every
 *   module in a panel on the left; the company name, Home; Units and Create;
 *   the five Ribbon tabs, Work, Company, Sales, Procurement and Finance,
 *   centred; then Search, the bell and the account. Under it, the open tab's
 *   ribbon, which folds away to leave the bar alone. Whether it is folded is
 *   kept per browser, in a cookie, so the server draws the right shell on the
 *   first paint and nothing swaps after hydration.
 * - Phone (below `lg`): one layout for everyone — the page's name and search
 *   at the top, the page's sections in a row under them, and the bar of five
 *   places at the bottom: Home, Projects, New, Inbox, Menu.
 */
export const RIBBON_COOKIE = "nesto.ribbon";

/** Whether the desktop ribbon is folded away, leaving the bar alone. Open unless folded. */
export function readRibbonFolded(value: string | undefined): boolean {
  return value === "folded";
}
