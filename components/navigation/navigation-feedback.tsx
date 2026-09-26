"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useResponseBeats, useRevealWatchdog } from "@/components/navigation/reveal-watchdog";
import { WORKSPACE_CHANGED } from "@/config/workspace";
import {
  createFeedbackStore,
  trackedDestination,
  type FeedbackStore,
  type NavigationSource,
  type NavigationTicket,
} from "@/lib/navigation/feedback-store";

/**
 * The shell's navigation feedback (NAV-01 §5.1, NAV-01..NAV-05).
 *
 * An accepted click paints at once: the link shows its own pending mark, a thin
 * bar runs along the top of the shell (visible after 150 ms, so a fast route
 * does not flash), and one polite status line is announced. The sidebar, top
 * bar and every other link stay usable, and choosing somewhere else simply
 * replaces the pending destination.
 *
 * It ends when the URL commits — wherever that is, a redirect included — or
 * when the navigation that owns it is cancelled or fails. Route commits are
 * observed with usePathname/useSearchParams; nothing hooks Next's internals.
 * Kept apart from record history and workspace authorization: it only draws.
 */

type FeedbackContextValue = {
  store: FeedbackStore;
  begin: (href: string, source: NavigationSource, opts?: { ownsWorkspaceSwitch?: boolean }) => NavigationTicket | null;
};

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null);

function currentLocation() {
  return { origin: window.location.origin, pathname: window.location.pathname, search: window.location.search };
}

export function NavigationFeedbackProvider({ identityKey, children }: { identityKey: string; children: React.ReactNode }) {
  const [store] = React.useState(() => createFeedbackStore());
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = `${pathname}?${searchParams.toString()}`;

  // Any commit ends the pending state: the destination, a redirect's, or elsewhere (NAV-03).
  const firstRoute = React.useRef(route);
  React.useEffect(() => {
    if (firstRoute.current === route) return;
    firstRoute.current = route;
    store.committed();
  }, [route, store]);

  // Another identity or workspace owns nothing that was pending before it (NAV-03).
  React.useEffect(() => () => store.reset(), [identityKey, store]);
  React.useEffect(() => {
    const onChange = () => store.workspaceChanged();
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [store]);

  const value = React.useMemo<FeedbackContextValue>(() => ({
    store,
    begin(href, source, opts) {
      const destination = trackedDestination(href, currentLocation());
      if (destination === null) return null;
      return store.begin(destination, source, opts);
    },
  }), [store]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useNavigationFeedback(): FeedbackContextValue | null {
  return React.useContext(FeedbackContext);
}

function useFeedbackSnapshot(store: FeedbackStore | undefined) {
  return React.useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.getSnapshot() ?? EMPTY,
    () => EMPTY,
  );
}

const EMPTY = { ticket: null, slow: false } as const;
const noopSubscribe = () => () => {};

/** Whether the pending navigation is heading to this href — a boolean, so a link re-renders only when it flips. */
export function usePendingDestination(href: string | null): boolean {
  const feedback = useNavigationFeedback();
  const store = feedback?.store;
  return React.useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => {
      if (!store || !href) return false;
      const destination = trackedDestination(href, currentLocation());
      return store.isPendingTo(destination);
    },
    () => false,
  );
}

/**
 * Whether the pending navigation stays on `pathname` and only changes its query —
 * a filter, a sort or another page of the same list — so the list on screen can
 * say it is being replaced rather than pass for the new answer (AUD-01 §9).
 */
export function usePendingQueryChange(pathname: string): boolean {
  const feedback = useNavigationFeedback();
  const store = feedback?.store;
  return React.useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => {
      const destination = store?.getSnapshot().ticket?.destination;
      return typeof destination === "string" && (destination === pathname || destination.startsWith(`${pathname}?`));
    },
    () => false,
  );
}

export type FeedbackNavigateOptions = {
  source?: NavigationSource;
  /** A ticket the caller already began — e.g. before a workspace switch — carried on to the navigation. */
  ticket?: NavigationTicket | null;
  scroll?: boolean;
};

/**
 * Programmatic navigation with the same feedback (NAV-04): begins a ticket,
 * runs the router call as a transition, and settles the ticket when that
 * transition ends without the URL changing (cancelled, same page, failed).
 * `router.push` is not awaitable; the transition is the correlated signal.
 */
export function useFeedbackRouter() {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const [isPending, startTransition] = React.useTransition();
  const ticket = React.useRef<NavigationTicket | null>(null);
  const wasPending = React.useRef(false);

  React.useEffect(() => {
    if (wasPending.current && !isPending) {
      feedback?.store.settle(ticket.current);
      ticket.current = null;
    }
    wasPending.current = isPending;
  }, [isPending, feedback]);

  return React.useMemo(() => {
    const go = (method: "push" | "replace", href: string, options: FeedbackNavigateOptions = {}) => {
      ticket.current = options.ticket ?? feedback?.begin(href, options.source ?? "record") ?? null;
      const routerOptions = options.scroll === undefined ? undefined : { scroll: options.scroll };
      startTransition(() => router[method](href, routerOptions));
    };
    const history = (direction: "back" | "forward") => {
      ticket.current = feedback?.store.begin(null, "history") ?? null;
      startTransition(() => (direction === "back" ? router.back() : router.forward()));
    };
    return {
      push: (href: string, options?: FeedbackNavigateOptions) => go("push", href, options),
      replace: (href: string, options?: FeedbackNavigateOptions) => go("replace", href, options),
      back: () => history("back"),
      forward: () => history("forward"),
      refresh: () => router.refresh(),
    };
  }, [router, feedback]);
}

/** The pending mark a link draws itself: a static dot at once, pulsing after 150 ms (§5.1). */
export function PendingDot({ className }: { className?: string }) {
  return <span aria-hidden="true" data-testid="nav-pending-hint" className={["nesto-pending-dot", className].filter(Boolean).join(" ")} />;
}

/**
 * The shell-level half: the top bar and the one status line. The status sits
 * outside any busy region so it is announced, once per navigation (§5.3).
 */
export function NavigationFeedbackIndicator() {
  const feedback = useNavigationFeedback();
  const { ticket, slow } = useFeedbackSnapshot(feedback?.store);
  const t = useTranslations("shell");
  // A navigation that has its page but has not shown it is woken (vercel/next.js#86151).
  useResponseBeats();
  useRevealWatchdog(ticket !== null);

  return (
    <>
      {ticket ? (
        <div
          key={ticket.id}
          aria-hidden="true"
          data-testid="nav-progress"
          data-source={ticket.source}
          className="nesto-nav-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
        >
          <span className="nesto-nav-progress-bar block h-full w-1/3 bg-accent" />
        </div>
      ) : null}
      <p
        role="status"
        data-testid="nav-status"
        className={slow
          ? "pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1.5 text-meta text-fg-muted shadow-md"
          : "sr-only"}
      >
        {ticket ? (slow ? t("slowNavigation") : t("loadingPage")) : ""}
      </p>
    </>
  );
}
