/**
 * Focus rules shared by the Dialog and Drawer primitives (AUD-11 §4, AV-05).
 *
 * - Opening: Radix focuses the first tabbable element. When that is a
 *   destructive action (a `danger` Button, or anything marked
 *   `data-destructive`), focus goes to the first safe control instead, so an
 *   accidental Enter never deletes. A caller's own `onOpenAutoFocus` that
 *   prevents the default (the AUD-03 prompt focuses Stay) always wins.
 * - Closing: Radix returns focus to the control that opened the overlay. When
 *   that control is gone (the row it belonged to was deleted), focus would
 *   fall to the document; it goes to the main region instead, so the next Tab
 *   continues in the page.
 */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

const DESTRUCTIVE = "[data-variant='danger'], [data-destructive]";

function tabbables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => !element.closest("[inert], [aria-hidden='true']") && element.getClientRects().length > 0,
  );
}

export function isDestructive(element: Element | null | undefined): boolean {
  return Boolean(element?.matches(DESTRUCTIVE));
}

/** For `onOpenAutoFocus`: steer initial focus off a destructive first control. */
export function safeInitialFocus(event: Event): void {
  if (event.defaultPrevented) return;
  const container = event.target as HTMLElement | null;
  if (!container || typeof container.querySelectorAll !== "function") return;
  const candidates = tabbables(container);
  if (!isDestructive(candidates[0])) return;
  event.preventDefault();
  const safe = candidates.find((element) => !isDestructive(element));
  (safe ?? container).focus({ preventScroll: true });
}

/** For `onCloseAutoFocus`: if the invoker is gone, land in the main region, not on the document. */
export function restoreFocusAfterClose(event: Event): void {
  if (event.defaultPrevented) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    document.getElementById("nesto-main")?.focus({ preventScroll: true });
  });
}
