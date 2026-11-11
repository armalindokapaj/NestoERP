/**
 * The line every panel opened from the top bar starts on: the lower edge of
 * the bar's own row, marked `data-topbar-row`. Search, Create, notifications
 * and the account panel all begin there, so they read as one family and never
 * float at different heights; from lg they open over the Ribbon, as Office's
 * menus open over its ribbon.
 */
export function topbarLine(from?: Element | null): number | null {
  if (typeof document === "undefined") return null;
  const row = topbarRow(from);
  return row ? row.getBoundingClientRect().bottom : null;
}

function topbarRow(from?: Element | null): HTMLElement | null {
  const row = from?.closest<HTMLElement>("[data-topbar-row]") ?? document.querySelector<HTMLElement>("[data-topbar-row]");
  return row && row.getClientRects().length > 0 ? row : null;
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

/** The content box panels line up with horizontally: the top bar row's, inside its gutters. */
export function topbarContentBox(from?: Element | null): { left: number; right: number } | null {
  if (typeof document === "undefined") return null;
  const box = topbarRow(from);
  if (!box) return null;
  const rect = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
}
