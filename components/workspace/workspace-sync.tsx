"use client";

import * as React from "react";

import { WORKSPACE_CHANGED, type WorkspaceChange } from "@/config/workspace";
import { WORKSPACE_CHANNEL } from "@/lib/workspace/client";

/** Keeps other tenant tabs from continuing under an obsolete session context. */
export function WorkspaceSync() {
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.onmessage = (event: MessageEvent<WorkspaceChange>) => {
      const change = event.data;
      if (!change || typeof change.workspaceVersion !== "number") return;
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
      window.location.reload();
    };
    return () => channel.close();
  }, []);
  return null;
}
