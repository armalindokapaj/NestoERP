"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { WorkspaceScopeType } from "@/config/workspace";
import {
  confirmWorkspaceNavigation,
  requestWorkspaceSwitch,
} from "@/lib/workspace/client";

const HISTORY_KEY = "nesto-record-navigation-v1";
const HISTORY_LIMIT = 75;

export type NavigationWorkspace = {
  key: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  group: { name: string; canEnter: boolean };
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

  React.useEffect(() => {
    const stored = readHistory();
    const current = stored.entries[stored.index];
    if (current?.route === route && current.workspaceKey === workspace.key) {
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
    setHistory(next);
    navigating.current = false;
  }, [route, workspace.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = React.useCallback(async (direction: -1 | 1) => {
    if (navigating.current) return;
    const targetIndex = history.index + direction;
    const target = history.entries[targetIndex];
    if (!target) return;
    navigating.current = true;

    const result = await requestWorkspaceSwitch({
      scopeType: target.scopeType,
      companyId: target.companyId,
      currentPathname: target.route.split("?")[0],
      currentSearch: target.route.includes("?") ? `?${target.route.split("?").slice(1).join("?")}` : "",
    }, { publishChange: target.workspaceKey !== workspace.key });
    if (!result.ok) {
      navigating.current = false;
      return;
    }

    movingTo.current = targetIndex;
    const destination = result.data.navigation.destination;
    const sameWorkspace = target.workspaceKey === workspace.key;
    const exact = destination === target.route;
    if (sameWorkspace && exact) {
      router.push(destination);
    } else {
      router.replace(destination);
    }
    window.dispatchEvent(new CustomEvent(direction < 0 ? "NAV_HISTORY_BACK" : "NAV_HISTORY_FORWARD"));
  }, [history, router, workspace.key]);

  const navigate = React.useCallback((href: string) => {
    if (navigating.current || !confirmWorkspaceNavigation()) return;
    navigating.current = true;
    router.push(href);
    window.dispatchEvent(new CustomEvent("NAV_BREADCRUMB_CLICK"));
  }, [router]);

  const navigateWorkspace = React.useCallback(async (scopeType: WorkspaceScopeType, companyId: string | null, href: string) => {
    if (navigating.current) return;
    navigating.current = true;
    const [currentPathname, query = ""] = href.split("?");
    const result = await requestWorkspaceSwitch({
      scopeType,
      companyId,
      currentPathname,
      currentSearch: query ? `?${query}` : "",
    });
    if (!result.ok) {
      navigating.current = false;
      return;
    }
    router.push(result.data.navigation.destination);
    window.dispatchEvent(new CustomEvent("NAV_BREADCRUMB_CLICK"));
  }, [router]);

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
