"use client";

import * as React from "react";

import { reconcileTabContext } from "@/components/unsaved/unsaved-host";
import { WORKSPACE_CHANGED } from "@/config/workspace";
import { unsaved } from "@/lib/unsaved/coordinator";
import { tabWorkspace } from "@/lib/unsaved/tab-context";
import { WORKSPACE_CHANNEL, WORKSPACE_TAB_ID, type WorkspaceChannelMessage } from "@/lib/workspace/client";

/**
 * Keeps other tenant tabs, and pages restored from history, from continuing
 * under an obsolete session context.
 *
 * A clean tab follows at once, as it always has: it reloads into the session's
 * workspace. A tab holding unsaved work is not reloaded underneath it (AUD-03
 * §7): its writes are held and the person decides — return to the workspace
 * this tab shows, or discard and follow.
 */
export function WorkspaceSync() {
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.onmessage = (event: MessageEvent<WorkspaceChannelMessage>) => {
      const change = event.data;
      if (!change || typeof change.workspaceVersion !== "number") return;
      // This tab's own switch, whose caller loads its destination itself (NAV-01 QC-11).
      if (change.sourceTab === WORKSPACE_TAB_ID && change.echo === false) return;
      const mine = tabWorkspace();
      // Another group's session is another identity: the identity channel decides.
      if (mine && change.parentGroupId !== mine.parentGroupId) return;
      // Already here — a switch back to what this tab shows, say. Nothing to do,
      // and no reload that could start another round of messages.
      if (mine && change.workspaceKey === mine.key) {
        if (unsaved.frozen?.reason === "workspace-changed") unsaved.freeze(null);
        return;
      }
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
      if (mine && unsaved.hasBlocking({ kind: "workspace", target: change.targetName ?? "" })) {
        unsaved.freeze({ reason: "workspace-changed", from: mine.name, to: change.targetName ?? null });
        return;
      }
      unsaved.forceLeave();
      window.location.reload();
    };
    return () => channel.close();
  }, []);

  // History restores (NAV-03 PREFETCH-06, F12). A page leaving is covered, so
  // a copy the browser keeps for Back/Forward comes back covered; a restored
  // copy is reloaded, which verifies the session's current workspace, rather
  // than shown. One holding unsaved work is checked against the server instead,
  // and stays covered — and unable to write — until the answer is in (UW-20).
  // Nothing is replayed: no approval survives the restore.
  React.useEffect(() => {
    const root = document.documentElement;
    const onPageHide = () => root.setAttribute("data-nesto-covered", "");
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        root.removeAttribute("data-nesto-covered");
        return;
      }
      unsaved.forgetApprovals();
      if (!unsaved.hasBlocking({ kind: "reload" })) {
        window.location.reload();
        return;
      }
      void reconcileTabContext().then(() => {
        // Somebody else's session never sees this draft; the notice reloads.
        if (unsaved.frozen?.reason !== "identity-changed") root.removeAttribute("data-nesto-covered");
      });
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
