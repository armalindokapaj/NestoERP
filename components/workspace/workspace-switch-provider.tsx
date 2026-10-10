"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useToast } from "@/components/ui/toast";
import type { WorkspaceScopeType } from "@/config/workspace";
import { unsaved } from "@/lib/unsaved/coordinator";
import { openInSwitchedWorkspace, requestWorkspaceSwitch, setWorkspaceSwitchInPlace } from "@/lib/workspace/client";

/**
 * Switching the workspace in place (OW §28-§36, §94).
 *
 * The same server switch as everywhere else — POST /api/workspace validates it
 * against the person's own access and answers with the route the resolver kept
 * (exact, parent, module home or Dashboard). What changes is what the tab does
 * next: no document load. The whole tree is fetched again from the root in one
 * transition — `router.refresh()` re-renders every layout and drops the entire
 * prefetch cache — so the sidebar header, the navigation and the page arrive in
 * one commit, and the header never names a workspace the page is not showing
 * (§33). The page content is keyed by the workspace in AppShell, so no client
 * state of the old workspace survives under the new header.
 *
 * Meanwhile the shell stays in place but inert, and the content region shows a
 * skeleton (§34). A refused switch changes nothing and says so (§35). A switch
 * that kept the exact route says nothing; a fallback says why the page changed
 * (§36). An unanswered request may have committed, so the tab re-reads the
 * canonical workspace rather than guessing. Should the shell come back still
 * naming the old workspace — a navigation started in the meantime can cancel
 * the refresh — the tab loads the page as a new document instead.
 */

export type WorkspaceTarget = { scopeType: WorkspaceScopeType; companyId: string | null; name: string };

type SwitchState = {
  name: string;
  phase: "request" | "commit";
  /** The shell's context key when the switch began: a new one means the new workspace has committed. */
  fromKey: string;
  /** Whether the server said it switched: then the shell must come back with another key. */
  switched: boolean;
  notice: string | null;
  sawPending: boolean;
};

type WorkspaceSwitchValue = {
  /** The workspace being entered, from the click until its shell and page have committed. */
  switchingTo: string | null;
  switchTo: (target: WorkspaceTarget) => void;
};

const WorkspaceSwitchContext = React.createContext<WorkspaceSwitchValue | null>(null);

export function WorkspaceSwitchProvider({
  contextKey,
  currentName,
  children,
}: {
  contextKey: string;
  /** The active workspace's name, for the message when a switch is refused. */
  currentName: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("workspace");
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [state, setState] = React.useState<SwitchState | null>(null);
  const busy = React.useRef(false);
  const keyRef = React.useRef(contextKey);
  keyRef.current = contextKey;

  const finish = React.useCallback(() => {
    busy.current = false;
    setWorkspaceSwitchInPlace(false);
    setState(null);
  }, []);

  const switchTo = React.useCallback(
    (target: WorkspaceTarget) => {
      if (busy.current) return;
      busy.current = true;

      void (async () => {
        // Unsaved work first, before the page is covered: Stay leaves the tab
        // exactly as it was and sends nothing (AUD-03 §7, OW §37).
        const approval = await unsaved.requestDeparture({ kind: "workspace", target: target.name });
        if (!approval) {
          busy.current = false;
          return;
        }
        setWorkspaceSwitchInPlace(true);
        const fromKey = keyRef.current;
        setState({ name: target.name, phase: "request", fromKey, switched: false, notice: null, sawPending: false });
        const here = `${window.location.pathname}${window.location.search}`;
        const result = await requestWorkspaceSwitch(
          { scopeType: target.scopeType, companyId: target.companyId, currentPathname: window.location.pathname, currentSearch: window.location.search },
          // This tab goes on itself, so its own channel echo must not reload it.
          { approval, targetName: target.name, echoToThisTab: false },
        );
        if (!result.ok) {
          if (result.cancelled) {
            finish();
            return;
          }
          // A newer request owns the tab now, and goes on by itself.
          if (result.stale) {
            finish();
            return;
          }
          if (result.ambiguous) {
            // It may have committed: draw whatever the server now says (§35).
            setState((previous) => previous && { ...previous, phase: "commit" });
            startTransition(() => router.refresh());
            return;
          }
          finish();
          toast({ title: t("switchFailed", { name: currentName }), tone: "danger" });
          return;
        }
        const { navigation, switched } = result.data;
        const notice =
          navigation.reason === "RECORD_NOT_AVAILABLE"
            ? t("recordFallback", { name: target.name })
            : navigation.resolution !== "KEEP_EXACT"
              ? t("moduleFallback", { name: target.name })
              : null;
        setState((previous) => previous && { ...previous, phase: "commit", switched, notice });
        startTransition(() => {
          if (navigation.destination !== here) router.replace(navigation.destination);
          router.refresh();
        });
      })();
    },
    [currentName, finish, router, t, toast],
  );

  // The switch is over once the new workspace's shell has committed — its key
  // changes with it — or, when nothing was switched, once the refresh settles.
  React.useEffect(() => {
    if (!state || state.phase !== "commit") return;
    if (contextKey !== state.fromKey) {
      if (state.notice) toast({ title: state.notice });
      finish();
      return;
    }
    if (isPending) {
      if (!state.sawPending) setState({ ...state, sawPending: true });
      return;
    }
    if (!state.sawPending) return;
    if (state.switched) {
      // Switched on the server, but this shell still draws the old workspace.
      openInSwitchedWorkspace(`${window.location.pathname}${window.location.search}`, { replace: true });
      return;
    }
    finish();
  }, [state, isPending, contextKey, finish, toast]);

  // The shell stays visible but takes no input while the switch is in flight (§34).
  const active = state !== null;
  React.useEffect(() => {
    if (!active) return;
    const regions = [...document.querySelectorAll<HTMLElement>("[data-shell-region]")];
    for (const region of regions) region.inert = true;
    return () => {
      for (const region of regions) region.inert = false;
    };
  }, [active]);

  const value = React.useMemo<WorkspaceSwitchValue>(() => ({ switchingTo: state?.name ?? null, switchTo }), [state?.name, switchTo]);

  return (
    <WorkspaceSwitchContext.Provider value={value}>
      {children}
      {state ? <SwitchingCover name={state.name} /> : null}
    </WorkspaceSwitchContext.Provider>
  );
}

/** The switch where the workspace shell provides one; null elsewhere (the Admin Console). */
export function useOptionalWorkspaceSwitch(): WorkspaceSwitchValue | null {
  return React.useContext(WorkspaceSwitchContext);
}

export function useWorkspaceSwitch(): WorkspaceSwitchValue {
  const value = React.useContext(WorkspaceSwitchContext);
  if (!value) throw new Error("useWorkspaceSwitch is used outside WorkspaceSwitchProvider.");
  return value;
}

/**
 * The content region while the next workspace loads (§34): the sidebar and the
 * top bar stay in view, still naming the current workspace; nothing of the page
 * under it can be read as the new workspace's or clicked.
 */
function SwitchingCover({ name }: { name: string }) {
  const t = useTranslations("workspace");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="workspace-switching"
      className="fixed bottom-0 left-[calc(var(--nesto-nav-width)+var(--nesto-workspace-rail-w))] right-0 top-14 z-20 flex flex-col items-center justify-center gap-4 bg-canvas/95 md:top-16"
    >
      <LoaderCircle aria-hidden="true" className="size-6 text-accent-strong motion-safe:animate-spin" />
      <p className="text-body font-medium text-fg">{t("switching", { name })}</p>
      <div aria-hidden="true" className="w-64 space-y-2">
        <div className="nesto-skeleton h-3" />
        <div className="nesto-skeleton h-3 w-4/5" />
        <div className="nesto-skeleton h-3 w-3/5" />
      </div>
    </div>
  );
}
