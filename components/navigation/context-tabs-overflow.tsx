"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useDesignVersion2 } from "@/lib/hooks/use-design-version";

/**
 * A tab row's overflow affordance (UI-02 §7, §24): one row that scrolls
 * sideways, and says so. While tabs lie beyond an edge the scroller carries
 * `data-more-start` or `data-more-end`, which version 2 draws as a fade and a
 * chevron at that edge (styles/tokens-v2.css), and the tab the page is on is
 * brought into view — on arrival and after every navigation — without moving
 * the page (AUD-04 §4, SP-09).
 *
 * Version 2 only: in version 1 it renders its hidden marker and does nothing.
 */
export function ContextTabsOverflow() {
  const marker = React.useRef<HTMLSpanElement>(null);
  const enabled = useDesignVersion2();
  const pathname = usePathname();

  React.useEffect(() => {
    const scroller = marker.current?.closest<HTMLElement>("[data-tab-scroller]");
    if (!enabled || !scroller) return;
    const update = () => {
      const beyond = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
      scroller.toggleAttribute("data-more-start", scroller.scrollLeft > 1);
      scroller.toggleAttribute("data-more-end", beyond > 1);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
      scroller.removeAttribute("data-more-start");
      scroller.removeAttribute("data-more-end");
    };
  }, [enabled]);

  React.useEffect(() => {
    const scroller = marker.current?.closest<HTMLElement>("[data-tab-scroller]");
    const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!enabled || !scroller || !active) return;
    const box = scroller.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    // 32px clear of the edge: the fade must not sit over the tab the page is on.
    if (item.left < box.left) scroller.scrollLeft -= box.left - item.left + 32;
    else if (item.right > box.right) scroller.scrollLeft += item.right - box.right + 32;
  }, [enabled, pathname]);

  return <span ref={marker} hidden />;
}
