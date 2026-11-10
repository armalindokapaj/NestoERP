import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where a piece of work came from, noted on every audit event it writes
 * (2026-11-10). A unit changed by a Google Sheet sync is changed by the very
 * service a person editing it would use, and that service writes its own
 * audit event; running the sync inside `withAuditSource("GOOGLE_SHEET_SYNC",
 * …)` adds `metadata.source` to each of those events, so the trail says the
 * change came from the sheet without every service taking a parameter for it.
 *
 * The note is the caller's, never the browser's: it is a fixed key a service
 * chooses. An event that already carries its own `source` keeps it.
 */
const storage = new AsyncLocalStorage<{ source: string }>();

export function withAuditSource<T>(source: string, work: () => Promise<T>): Promise<T> {
  return storage.run({ source }, work);
}

/** The source the current work runs under, if any. */
export function currentAuditSource(): string | undefined {
  return storage.getStore()?.source;
}
