import * as React from "react";

/**
 * Only the newest read may land (AUD-07 §6, PS-10).
 *
 * A search typed quickly, a filter changed twice, a second record opened
 * before the first arrived: each starts a read, and the answers come back in
 * whatever order the network likes. `begin()` aborts the previous read and
 * hands back a ticket; a response is applied only while its ticket is still
 * current, so a slow old query can never replace newer results — and the
 * aborted one ends quietly instead of as an unhandled rejection.
 *
 *   const latest = useLatestRequest();
 *   const ticket = latest.begin();
 *   try {
 *     const rows = await someApi(url, { signal: ticket.signal });
 *     if (ticket.current()) setRows(rows);
 *   } catch (error) {
 *     if (ticket.current() && !isAborted(error)) setError(...);
 *   } finally {
 *     if (ticket.current()) setLoading(false);
 *   }
 */

export type RequestTicket = { signal: AbortSignal; current: () => boolean };

export class LatestRequest {
  private controller: AbortController | null = null;
  private generation = 0;

  begin(): RequestTicket {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const mine = ++this.generation;
    return { signal: controller.signal, current: () => mine === this.generation && !controller.signal.aborted };
  }

  /** Nothing in flight may land any more: the context it belonged to is gone. */
  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

/** One `LatestRequest` for a component's lifetime, cancelled when it unmounts. */
export function useLatestRequest(): LatestRequest {
  const ref = React.useRef<LatestRequest | null>(null);
  if (ref.current === null) ref.current = new LatestRequest();
  const latest = ref.current;
  React.useEffect(() => () => latest.cancel(), [latest]);
  return latest;
}
