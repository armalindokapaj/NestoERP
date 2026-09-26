"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import type { WorkspaceScopeType } from "@/config/workspace";
import type { NavigationTicket } from "@/lib/navigation/feedback-store";
import { guardNavigation } from "@/components/navigation/guarded-router";
import { unsaved } from "@/lib/unsaved/coordinator";
import {
  openInSwitchedWorkspace,
  requestWorkspaceSwitch,
} from "@/lib/workspace/client";

const HISTORY_KEY = "nesto-record-navigation-v1";
const HISTORY_LIMIT = 75;
const BROWSER_INDEX_KEY = "__nestoNavigationIndex";

export type NavigationWorkspace = {
  key: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  /** Whether the Group view can be entered is streamed separately: `useGroupEntry` (NAV-02 COMPAT-01). */
  group: { name: string };
  company: { name: string; id: string } | null;
};

type HistoryEntry = {
  route: string;
  workspaceKey: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  timestamp: number;
};

type StoredHistory = { entries: HistoryEntry[]; index: number };

type NavigationContextValue = {
  workspace: NavigationWorkspace;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  navigate: (href: string) => void;
  navigateWorkspace: (scopeType: WorkspaceScopeType, companyId: string | null, href: string) => void;
};

const NavigationContext = React.createContext<NavigationContextValue | null>(null);

function readHistory(): StoredHistory {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "null") as StoredHistory | null;
    if (!parsed || !Array.isArray(parsed.entries) || !Number.isInteger(parsed.index)) return { entries: [], index: -1 };
    return {
      entries: parsed.entries.slice(-HISTORY_LIMIT),
      index: Math.min(parsed.index, parsed.entries.length - 1),
    };
  } catch {
    return { entries: [], index: -1 };
  }
}

function writeHistory(value: StoredHistory): void {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(value));
  } catch {
    // Navigation still works through the framework if storage is unavailable.
  }
}

function browserHistoryIndex(): number | null {
  const value = window.history.state?.[BROWSER_INDEX_KEY];
  return Number.isInteger(value) ? value : null;
}

function tagBrowserHistory(index: number): void {
  const current = window.history.state;
  window.history.replaceState({ ...(current && typeof current === "object" ? current : {}), [BROWSER_INDEX_KEY]: index }, "");
}

export function RecordNavigationProvider({
  workspace,
  children,
}: {
  workspace: NavigationWorkspace;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const route = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  const [history, setHistory] = React.useState<StoredHistory>({ entries: [], index: -1 });
  const movingTo = React.useRef<number | null>(null);
  const navigating = React.useRef(false);
  const feedback = useNavigationFeedback();
  // Router calls run as transitions: when one ends without a commit (cancelled, same page), the
  // lock and the shell's pending feedback are released rather than left stuck (NAV-04).
  const [transitionPending, startTransition] = React.useTransition();
  const ticket = React.useRef<NavigationTicket | null>(null);
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (wasPending.current && !transitionPending) {
      navigating.current = false;
      feedback?.store.settle(ticket.current);
      ticket.current = null;
    }
    wasPending.current = transitionPending;
  }, [transitionPending, feedback]);

  React.useEffect(() => {
    const stored = readHistory();
    const browserIndex = browserHistoryIndex();
    const browserEntry = browserIndex === null ? undefined : stored.entries[browserIndex];
    if (browserIndex !== null && browserEntry?.route === route && browserEntry.workspaceKey === workspace.key) {
      const restored = { ...stored, index: browserIndex };
      writeHistory(restored);
      setHistory(restored);
      return;
    }
    const current = stored.entries[stored.index];
    if (current?.route === route && current.workspaceKey === workspace.key) {
      tagBrowserHistory(stored.index);
      setHistory(stored);
      return;
    }
    const entries = stored.entries.slice(0, stored.index + 1);
    entries.push({
      route,
      workspaceKey: workspace.key,
      scopeType: workspace.scopeType,
      companyId: workspace.companyId,
      timestamp: Date.now(),
    });
    const limited = entries.slice(-HISTORY_LIMIT);
    const next = { entries: limited, index: limited.length - 1 };
    writeHistory(next);
    tagBrowserHistory(next.index);
    setHistory(next);
  // The route-change effect below owns subsequent entries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (history.index < 0) return;
    if (movingTo.current !== null) {
      const index = movingTo.current;
      movingTo.current = null;
      navigating.current = false;
      const next = { ...history, index };
      writeHistory(next);
      tagBrowserHistory(next.index);
      setHistory(next);
      return;
    }

    const current = history.entries[history.index];
    if (current?.route === route && current.workspaceKey === workspace.key) {
      navigating.current = false;
      return;
    }
    const entries = history.entries.slice(0, history.index + 1);
    const previous = entries.at(-1);
    if (previous?.route !== route || previous.workspaceKey !== workspace.key) {
      entries.push({ route, workspaceKey: workspace.key, scopeType: workspace.scopeType, companyId: workspace.companyId, timestamp: Date.now() });
    }
    const limited = entries.slice(-HISTORY_LIMIT);
    const next = { entries: limited, index: limited.length - 1 };
    writeHistory(next);
    tagBrowserHistory(next.index);
    setHistory(next);
    navigating.current = false;
  }, [route, workspace.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = React.useCallback(async (direction: -1 | 1) => {
    if (navigating.current) return;
    const targetIndex = history.index + direction;
    const target = history.entries[targetIndex];
    if (!target) return;
    navigating.current = true;
    const crossing = target.workspaceKey !== workspace.key;
    // Unsaved work first, and nothing begins on Stay (AUD-03 §4, §5).
    const approval = await unsaved.requestDeparture(crossing ? { kind: "workspace", target: "" } : { kind: "navigate", href: target.route });
    if (!approval) {
      navigating.current = false;
      return;
    }
    ticket.current = feedback?.store.begin(null, "history", { ownsWorkspaceSwitch: crossing }) ?? null;

    const result = await requestWorkspaceSwitch({
      scopeType: target.scopeType,
      companyId: target.companyId,
      currentPathname: target.route.split("?")[0],
      currentSearch: target.route.includes("?") ? `?${target.route.split("?").slice(1).join("?")}` : "",
    }, crossing ? { approval, publishChange: true, echoToThisTab: false } : { prior: approval, publishChange: false, echoToThisTab: false });
    if (!result.ok) {
      navigating.current = false;
      feedback?.store.settle(ticket.current);
      return;
    }

    movingTo.current = targetIndex;
    const nextHistory = { ...history, index: targetIndex };
    writeHistory(nextHistory);
    setHistory(nextHistory);
    const destination = result.data.navigation.destination;
    if (crossing) {
      // The stored history already points at the target; the new document restores it.
      window.dispatchEvent(new CustomEvent(direction < 0 ? "NAV_HISTORY_BACK" : "NAV_HISTORY_FORWARD"));
      openInSwitchedWorkspace(destination, { replace: true });
      return;
    }
    startTransition(() => {
      if (destination === target.route) {
        if (direction < 0) router.back();
        else router.forward();
      } else {
        router.replace(destination);
      }
    });
    window.dispatchEvent(new CustomEvent(direction < 0 ? "NAV_HISTORY_BACK" : "NAV_HISTORY_FORWARD"));
  }, [history, router, workspace.key, feedback]);

  const navigate = React.useCallback((href: string) => {
    if (navigating.current) return;
    guardNavigation({ kind: "navigate", href }, () => {
      navigating.current = true;
      ticket.current = feedback?.begin(href, "breadcrumb") ?? null;
      startTransition(() => router.push(href));
      window.dispatchEvent(new CustomEvent("NAV_BREADCRUMB_CLICK"));
    });
  }, [router, feedback]);

  const navigateWorkspace = React.useCallback(async (scopeType: WorkspaceScopeType, companyId: string | null, href: string) => {
    if (navigating.current) return;
    navigating.current = true;
    const approval = await unsaved.requestDeparture({ kind: "workspace", target: "" });
    if (!approval) {
      navigating.current = false;
      return;
    }
    ticket.current = feedback?.begin(href, "workspace", { ownsWorkspaceSwitch: true }) ?? null;
    const [currentPathname, query = ""] = href.split("?");
    const result = await requestWorkspaceSwitch({
      scopeType,
      companyId,
      currentPathname,
      currentSearch: query ? `?${query}` : "",
    }, { approval, echoToThisTab: false });
    if (!result.ok) {
      navigating.current = false;
      feedback?.store.settle(ticket.current);
      return;
    }
    window.dispatchEvent(new CustomEvent("NAV_BREADCRUMB_CLICK"));
    if (result.data.switched) openInSwitchedWorkspace(result.data.navigation.destination);
    else startTransition(() => router.push(result.data.navigation.destination));
  }, [router, feedback]);

  return (
    <NavigationContext.Provider value={{
      workspace,
      canGoBack: history.index > 0,
      canGoForward: history.index >= 0 && history.index < history.entries.length - 1,
      goBack: () => void move(-1),
      goForward: () => void move(1),
      navigate,
      navigateWorkspace: (scopeType, companyId, href) => void navigateWorkspace(scopeType, companyId, href),
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useRecordNavigation(): NavigationContextValue | null {
  return React.useContext(NavigationContext);
}
