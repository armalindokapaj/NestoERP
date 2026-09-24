"use client";

import * as React from "react";

import { WORKSPACE_CHANGED } from "@/config/workspace";
import { WORKSPACE_CHANNEL, WORKSPACE_TAB_ID, type WorkspaceChannelMessage } from "@/lib/workspace/client";

/** Keeps other tenant tabs from continuing under an obsolete session context. */
export function WorkspaceSync() {
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.onmessage = (event: MessageEvent<WorkspaceChannelMessage>) => {
      const change = event.data;
      if (!change || typeof change.workspaceVersion !== "number") return;
      // This tab's own switch, whose caller loads its destination itself (NAV-01 QC-11).
      if (change.sourceTab === WORKSPACE_TAB_ID && change.echo === false) return;
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
      window.location.reload();
    };
    return () => channel.close();
  }, []);
  return null;
}
