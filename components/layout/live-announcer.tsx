"use client";

import * as React from "react";

import {
  getAnnouncerState,
  getServerAnnouncerState,
  subscribeAnnouncer,
} from "@/lib/a11y/announcer";

/**
 * The two stable live regions (AUD-11 §5, AV-09), mounted once by the app
 * shell. Call `announce()` from `@/lib/a11y/announcer` to speak through them.
 *
 * The regions themselves never unmount; each message is a fresh child keyed by
 * its id, so a repeated message is noticed without the region flickering.
 */
export function LiveAnnouncer() {
  const state = React.useSyncExternalStore(subscribeAnnouncer, getAnnouncerState, getServerAnnouncerState);

  return (
    <div className="sr-only" data-testid="live-announcer">
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer-polite">
        {state.polite.message ? <p key={state.polite.id}>{state.polite.message}</p> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-announcer-assertive">
        {state.assertive.message ? <p key={state.assertive.id}>{state.assertive.message}</p> : null}
      </div>
    </div>
  );
}
