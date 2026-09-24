"use client";

import * as React from "react";
import NextLink, { useLinkStatus } from "next/link";

import { useNavigationFeedback, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useIntentScheduler } from "@/components/navigation/intent-prefetch";
import type { NavigationSource, NavigationTicket } from "@/lib/navigation/feedback-store";
import { intentRoute } from "@/lib/navigation/intent-prefetch";

type NextLinkProps = React.ComponentProps<typeof NextLink>;

export type NavLinkProps = NextLinkProps & {
  /** Where the click came from, for the shell's feedback and its measurements. */
  navSource?: NavigationSource;
  /**
   * Join the route-intent policy (NAV-03 PREFETCH-01): for one of the five
   * approved destinations, automatic prefetch is off and a deliberate hover
   * or focus asks the tab's scheduler instead. Anything else is unchanged.
   */
  intent?: boolean;
};

function hrefString(href: NextLinkProps["href"]): string {
  if (typeof href === "string") return href;
  const query = href.query
    ? `?${new URLSearchParams(Object.entries(href.query).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, String(item)]) : value === undefined || value === null ? [] : [[key, String(value)]]))).toString()}`
    : (href.search ?? "");
  return `${href.pathname ?? ""}${query}${href.hash ?? ""}`;
}

/**
 * Ends this link's ticket when its own transition ends without a commit — a
 * cancelled or superseded navigation (NAV-03). Only a true→false change
 * counts: the hook's first `false` says nothing about a ticket just begun.
 */
function LinkStatusReporter({ ticket }: { ticket: React.RefObject<NavigationTicket | null> }) {
  const { pending } = useLinkStatus();
  const feedback = useNavigationFeedback();
  const was = React.useRef(false);
  React.useEffect(() => {
    if (was.current && !pending) feedback?.store.settle(ticket.current);
    was.current = pending;
  }, [pending, feedback, ticket]);
  return null;
}

/**
 * NESTO's `Link` (NAV-01 NAV-01, NAV-02): `next/link` with the shell's
 * immediate feedback. A drop-in — same props, same routing, same prefetch.
 *
 * Feedback begins in `onNavigate`, which Next calls only for a navigation it
 * accepted: never for a modified or middle click, a download, another origin,
 * or a handler that prevented it. A same-page or hash-only href begins nothing.
 * While pending the anchor carries `data-nav-pending`, which the shell's CSS
 * marks without relying on colour alone.
 */
export default function Link({ navSource = "record", onNavigate, intent = false, children, ...props }: NavLinkProps) {
  const feedback = useNavigationFeedback();
  const scheduler = useIntentScheduler();
  const ticket = React.useRef<NavigationTicket | null>(null);
  const href = hrefString(props.href);
  const pending = usePendingDestination(href);
  const route = intent && scheduler && !props.target && !props.download ? intentRoute(href) : null;
  const intentHandlers = route
    ? {
        prefetch: false as const,
        onPointerEnter: (event: React.PointerEvent<HTMLAnchorElement>) => {
          props.onPointerEnter?.(event);
          // Touch contact is not intent; a tap navigates at once (PREFETCH-03).
          if (event.pointerType === "mouse") scheduler!.intent(route, "hover");
        },
        onPointerLeave: (event: React.PointerEvent<HTMLAnchorElement>) => {
          props.onPointerLeave?.(event);
          scheduler!.leave(route);
        },
        onFocus: (event: React.FocusEvent<HTMLAnchorElement>) => {
          props.onFocus?.(event);
          scheduler!.intent(route, "focus");
        },
        onBlur: (event: React.FocusEvent<HTMLAnchorElement>) => {
          props.onBlur?.(event);
          scheduler!.leave(route);
        },
      }
    : {};

  return (
    <NextLink
      {...props}
      {...intentHandlers}
      data-nav-pending={pending || undefined}
      onNavigate={(event) => {
        // The event only offers preventDefault; a caller that used it cancelled the navigation.
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
            event.preventDefault();
          },
        });
        if (prevented) return;
        ticket.current = feedback?.begin(href, navSource) ?? null;
      }}
    >
      {children}
      <LinkStatusReporter ticket={ticket} />
    </NextLink>
  );
}
