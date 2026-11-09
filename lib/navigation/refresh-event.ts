/**
 * Reading a page again in place (mobile audit 5c).
 *
 * `router.refresh()` re-renders the page's server components; lists a client
 * component holds itself (the Approvals queue, the notification bell) are not
 * part of that. When the shell refreshes a page — pull to refresh, or Refresh
 * in the More sheet — it fires `REFRESH_DATA_EVENT` on `window` as well, and
 * such a list reads itself again on it, through `onDataRefresh`.
 *
 * `REQUEST_REFRESH_EVENT` asks the shell to do that refresh, so a control
 * anywhere (the More sheet) gets the same indicator and announcements as the
 * gesture (components/layout/pull-to-refresh.tsx).
 */

export const REFRESH_DATA_EVENT = "nesto:refresh-data";
export const REQUEST_REFRESH_EVENT = "nesto:request-refresh";

/** Calls `listener` whenever the shell refreshes the page's data; returns the undo. */
export function onDataRefresh(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(REFRESH_DATA_EVENT, listener);
  return () => window.removeEventListener(REFRESH_DATA_EVENT, listener);
}

/** Tells client-held lists the page's data is being read again. */
export function announceDataRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_DATA_EVENT));
}

/** Asks the shell to refresh the page, as pulling down at the top of it does. */
export function requestPageRefresh(): void {
  window.dispatchEvent(new Event(REQUEST_REFRESH_EVENT));
}
