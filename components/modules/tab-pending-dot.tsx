"use client";

import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";

/**
 * A route tab's pending mark (NAV-01 NAV-04). Tabs are server-rendered, so the
 * mark is the one client piece: it appears the moment the tab's navigation is
 * accepted, while `aria-current` stays on the tab that is still shown.
 */
export function TabPendingDot({ href }: { href: string }) {
  return usePendingDestination(href) ? <PendingDot className="absolute right-0.5 top-1.5 text-accent" /> : null;
}
