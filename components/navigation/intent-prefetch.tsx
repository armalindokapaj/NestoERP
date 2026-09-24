"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { createIntentScheduler, type IntentRoute, type IntentScheduler } from "@/lib/navigation/intent-prefetch";
import { isLeavingForWorkspaceSwitch, isWorkspaceSwitchInPlace } from "@/lib/workspace/client";

/**
 * The tab's one route-intent scheduler (NAV-03 PREFETCH-01): participating
 * links hand it a deliberate hover or focus and it decides whether to prepare
 * the destination. A changed identity or workspace resets it. Off entirely
 * when the server says so; links then keep ordinary navigation.
 */

const IntentContext = React.createContext<IntentScheduler | null>(null);

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

export function IntentPrefetchProvider({ contextKey, enabled, children }: { contextKey: string; enabled: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const busyRef = React.useRef<() => boolean>(() => false);
  busyRef.current = () => Boolean(feedback?.store.getSnapshot().ticket) || isLeavingForWorkspaceSwitch() || isWorkspaceSwitchInPlace();

  const [scheduler] = React.useState(() =>
    createIntentScheduler({
      contextKey,
      // Auto, as a link would: the loading boundary, not a full server render of the page
      // (router.prefetch alone defaults to a full prefetch).
      prefetch: (route: IntentRoute) => router.prefetch(route, { kind: "auto" as Parameters<typeof router.prefetch>[1] extends { kind: infer K } | undefined ? K : never }),
      environment: {
        now: () => Date.now(),
        setTimeout: (run, ms) => window.setTimeout(run, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
        allowed: () => {
          if (document.visibilityState !== "visible" || navigator.onLine === false) return false;
          const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
          return !connection?.saveData && connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
        },
        busy: () => busyRef.current(),
        currentPath: () => window.location.pathname,
      },
    }),
  );

  React.useEffect(() => scheduler.reset(contextKey), [scheduler, contextKey]);
  React.useEffect(() => scheduler.setEnabled(enabled), [scheduler, enabled]);

  return <IntentContext.Provider value={enabled ? scheduler : null}>{children}</IntentContext.Provider>;
}

export function useIntentScheduler(): IntentScheduler | null {
  return React.useContext(IntentContext);
}
