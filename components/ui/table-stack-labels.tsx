"use client";

import * as React from "react";

/**
 * Gives each cell of the table beside it the heading of its column, as
 * `data-label`, so a stacked phone card can print "Status  Active" (see
 * `stack` on Table). Set on the DOM after hydration and again if the rows
 * change; the markup React renders is untouched, and above `md` the labels are
 * never shown.
 */
export function TableStackLabels() {
  const marker = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const table = marker.current?.previousElementSibling;
    if (!(table instanceof HTMLTableElement)) return;
    const label = () => {
      const headings = Array.from(table.querySelectorAll("thead th")).map((heading) => heading.textContent?.trim() ?? "");
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        Array.from(row.children).forEach((cell, index) => {
          if (index === 0) return;
          const text = headings[index] ?? "";
          if (cell.getAttribute("data-label") !== text) cell.setAttribute("data-label", text);
        });
      }
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} hidden />;
}
