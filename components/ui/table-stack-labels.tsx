"use client";

import * as React from "react";

/**
 * Gives each cell of the table beside it the heading of its column, as
 * `data-label`, so a stacked phone card can print "Status  Active" (see
 * `stack` on Table, or `data-stack` on a table built by hand with this right
 * after it). Set on the DOM after hydration and again if the rows change; the
 * markup React renders is untouched, and the labels are shown only while the
 * table is drawn as cards. A cell spanning columns counts as all of them, so
 * the cells after it keep their own headings, and a heading only a screen
 * reader hears (an "Actions" column) labels nothing on screen.
 */
export function TableStackLabels() {
  const marker = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const table = marker.current?.previousElementSibling;
    if (!(table instanceof HTMLTableElement)) return;
    const label = () => {
      const headings: string[] = [];
      const head = table.querySelector("thead tr:last-child");
      for (const heading of Array.from(head?.children ?? [])) {
        const text = visibleText(heading).trim();
        for (let span = 0; span < Math.max(1, (heading as HTMLTableCellElement).colSpan || 1); span += 1) headings.push(text);
      }
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        let column = 0;
        Array.from(row.children).forEach((cell, index) => {
          const at = column;
          column += Math.max(1, (cell as HTMLTableCellElement).colSpan || 1);
          if (index === 0) return;
          const text = headings[at] ?? "";
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

/** A heading's words as drawn: text inside `.sr-only` (or a heading that is itself one) is left out. */
function visibleText(node: Node): string {
  if (node instanceof Element && node.classList.contains("sr-only")) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(visibleText).join("");
}
