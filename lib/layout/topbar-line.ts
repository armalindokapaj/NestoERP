/**
 * The line every panel opened from the top bar starts on: the breadcrumb bar's
 * top edge, which is also the top bar's lower edge. Search, Create,
 * notifications, the account panel and the workspace switcher all begin there,
 * so they read as one family and never float at different heights.
 *
 * A surface with no breadcrumb bar (the group area, a phone) uses the lower
 * edge of the top bar's own row, marked `data-topbar-row`.
 */
export function topbarLine(from?: Element | null): number | null {
  if (typeof document === "undefined") return null;
  const bar = document.querySelector<HTMLElement>("[data-shell-breadcrumb]");
  if (bar && bar.getClientRects().length > 0) return bar.getBoundingClientRect().top;
  const row = from?.closest<HTMLElement>("[data-topbar-row]") ?? document.querySelector<HTMLElement>("[data-topbar-row]");
  return row && row.getClientRects().length > 0 ? row.getBoundingClientRect().bottom : null;
}

/**
 * For a popover anchored to a top-bar control: the gap below the control that
 * puts the popover's top edge on that line.
 */
export function topbarOffset(trigger: Element | null, fallback = 8): number {
  const line = topbarLine(trigger);
  if (line === null || !trigger) return fallback;
  // Not rounded: a control centred in the bar sits on a half pixel, and the panel's edge must land on the line.
  return Math.max(0, line - trigger.getBoundingClientRect().bottom);
}

/**
 * The content box panels line up with horizontally: the breadcrumb bar's, or
 * the top bar row's where there is no breadcrumb bar.
 */
export function topbarContentBox(from?: Element | null): { left: number; right: number } | null {
  if (typeof document === "undefined") return null;
  const bar = document.querySelector<HTMLElement>("[data-shell-breadcrumb]");
  const box = bar && bar.getClientRects().length > 0 ? bar : (from?.closest<HTMLElement>("[data-topbar-row]") ?? document.querySelector<HTMLElement>("[data-topbar-row]"));
  if (!box || box.getClientRects().length === 0) return null;
  const rect = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
}
