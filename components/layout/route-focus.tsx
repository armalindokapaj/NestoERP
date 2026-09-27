"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { clearAnnouncements } from "@/lib/a11y/announcer";

/**
 * Focus after an accepted navigation (AUD-11 §4, AV-04).
 *
 * Only when focus was lost — the link that was activated went away with the
 * old page and focus fell back to the document — is it placed on the main
 * region, so the next Tab starts in the new page rather than at the top of the
 * shell. A sidebar link, the search box or a filter that is still on screen
 * keeps focus; a search-parameter change (an in-place filter) is not a new
 * page and is ignored; a cancelled navigation never changes the pathname, so
 * focus never moves into a destination that did not mount.
 *
 * Next.js announces the new document title itself, so this says nothing. It
 * does empty the shell's live regions, so nothing about the previous page is
 * read out on the next one.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previous = React.useRef(pathname);

  React.useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    clearAnnouncements();

    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (!lost) return;
    document.getElementById("nesto-main")?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
