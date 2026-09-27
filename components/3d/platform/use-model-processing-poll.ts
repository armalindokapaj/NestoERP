"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi } from "@/components/engineering/engineering-api";

type PolledVersion = { id: string; status: string; stalled?: boolean };
type PolledSlot = { versions: PolledVersion[] };

const POLL_MS = 3000;
/** A poll that has watched this long without a change stops; Refresh status is always there. */
const POLL_LIMIT_MS = 10 * 60 * 1000;

function signature(version: PolledVersion): string {
  return `${version.status}:${version.stalled ? 1 : 0}`;
}

/**
 * Watches models that are being prepared and refreshes the page's data once
 * one changes state — READY, FAILED, or stalled. It reads statuses only (no
 * signed URLs, no manifests), only while the tab is visible, and only while
 * something is actually being prepared. A refresh keeps every unsaved edit in
 * the tab: the editor's state lives in the client, not in the server props.
 */
export function useModelProcessingPoll(projectId: string, slots: PolledSlot[], watchVersionId: string | null = null): void {
  const router = useRouter();
  const versions = slots.flatMap((slot) => slot.versions);
  const preparing = versions.some((version) => version.status === "PROCESSING" && !version.stalled);
  const watching = Boolean(watchVersionId && !versions.some((version) => version.id === watchVersionId && version.status !== "UPLOADED" && version.status !== "PROCESSING"));
  const known = React.useRef(new Map<string, string>());
  known.current = new Map(versions.map((version) => [version.id, signature(version)]));

  React.useEffect(() => {
    if (!preparing && !watching) return;
    const started = Date.now();
    let inFlight = false;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const latest = await engineeringApi<PolledVersion[]>(`/api/platform/3d/projects/${projectId}/model-status`);
        if (stopped) return;
        const changed = latest.length !== known.current.size || latest.some((version) => known.current.get(version.id) !== signature(version));
        if (changed) router.refresh();
      } catch {
        // A missed poll is not an error the author has to see; the next one tries again.
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [preparing, watching, projectId, router]);
}
