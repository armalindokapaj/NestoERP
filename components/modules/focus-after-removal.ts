/**
 * Focus after a row is removed in place (AUD-11 §4, AV-04).
 *
 * Deleting, archiving or unlinking a row removes the button that was focused,
 * and the browser then drops focus to <body>: a keyboard or screen-reader user
 * is thrown back to the top of the page. Call `planFocusAfterRemoval` with the
 * control (or row) *before* the mutation, then call the returned function once
 * the mutation has succeeded. When the row actually leaves the DOM, focus moves
 * to the next row (or the previous one when it was the last), else to the
 * list's heading. It never steals focus the user has already moved elsewhere,
 * and does nothing when the row survives (a failed or refused mutation).
 */

const ROW = "li, tr, [data-row]";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const WAIT_MS = 5_000;

function focusable(root: Element | null | undefined): HTMLElement | null {
  if (!root || !root.isConnected) return null;
  if (root.matches(FOCUSABLE)) return root as HTMLElement;
  return root.querySelector<HTMLElement>(FOCUSABLE);
}

function headingOf(region: Element | null | undefined): HTMLElement | null {
  const scope = region?.isConnected ? region : document.querySelector("main");
  return scope?.querySelector<HTMLElement>("h1, h2, h3, [data-list-heading]") ?? null;
}

/** A confirm dialog opened from the row still holds focus while it closes. */
function overlayHoldsFocus(row: Element): boolean {
  const overlay = document.activeElement?.closest("[role='dialog'], [role='alertdialog']");
  return !!overlay && !overlay.contains(row);
}

function userMovedOn(row: Element): boolean {
  const active = document.activeElement;
  // Focus is only ours to place when it is lost (body) or still inside the row.
  return !!active && active !== document.body && !row.contains(active);
}

export function planFocusAfterRemoval(from: Element | null | undefined, rowSelector: string = ROW): () => void {
  if (typeof document === "undefined" || !from) return () => undefined;
  const row = from.closest(rowSelector) ?? from;
  const container = row.parentElement;
  const siblings = container ? Array.from(container.children) : [];
  const index = siblings.indexOf(row);
  const next = siblings[index + 1] ?? null;
  const previous = index > 0 ? siblings[index - 1] : null;
  const region = row.closest("section, [role='region'], [role='dialog'], main");

  const place = () => {
    if (userMovedOn(row)) return;
    const target = focusable(next) ?? focusable(previous) ?? headingOf(region);
    if (!target) return;
    if (!target.matches(FOCUSABLE) && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  };

  const ready = () => !row.isConnected && !overlayHoldsFocus(row);

  return () => {
    if (ready()) {
      place();
      return;
    }
    // The list re-renders after a refresh and the confirm dialog unmounts;
    // wait for both, but not forever.
    const observer = new MutationObserver(() => {
      if (!ready()) return;
      observer.disconnect();
      window.clearTimeout(timer);
      place();
    });
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_MS);
    observer.observe(document.body, { childList: true, subtree: true });
  };
}
