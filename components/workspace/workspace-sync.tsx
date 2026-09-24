"use client";

import * as React from "react";

import { WORKSPACE_CHANGED } from "@/config/workspace";
import { WORKSPACE_CHANNEL, WORKSPACE_TAB_ID, type WorkspaceChannelMessage } from "@/lib/workspace/client";

/** Keeps other tenant tabs, and pages restored from history, from continuing under an obsolete session context. */
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

  // History restores (NAV-03 PREFETCH-06, F12). A page leaving is covered, so
  // a copy the browser keeps for Back/Forward comes back covered; a restored
  // copy is reloaded, which verifies the session's current workspace, rather
  // than shown. Nothing is replayed: the reload is a plain document load.
  React.useEffect(() => {
    const root = document.documentElement;
    const onPageHide = () => root.setAttribute("data-nesto-covered", "");
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
      else root.removeAttribute("data-nesto-covered");
    };
    root.removeAttribute("data-nesto-covered");
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
