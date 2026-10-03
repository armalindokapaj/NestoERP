import * as React from "react";

import { TableScrollRegion } from "@/components/ui/scroll-region";
import { TableStackLabels } from "@/components/ui/table-stack-labels";
import { cn } from "@/lib/utils/cn";

/**
 * Table (design spec §21, §22, §23, §57, §79).
 *
 * Flat, minimal separators, no vertical rules. The header sticks while the
 * body scrolls, and wide tables scroll horizontally inside their own container
 * rather than pushing the page sideways (§79).
 *
 * That container is a labelled region, focusable while there is something to
 * scroll, so the sideways scroll works from the keyboard and is announced
 * (AUD-04 §5, SP-02). Name it after the records (`label="Invoices"`); an
 * unnamed table falls back to its own `aria-label`, then a generic name.
 *
 * Because the container scrolls, the sticky header sticks within it — or
 * within a caller's own bounded vertical scroller — and never to the page, so
 * it cannot slide under the sticky top bar.
 */
export function Table({
  className,
  flush = false,
  stack = false,
  label,
  ...props
}: React.ComponentProps<"table"> & {
  flush?: boolean;
  /**
   * On a phone each row becomes a card: the first cell is its title, the rest
   * are "label  value" lines taken from the column headings. Above `md` it is
   * the table. Same rows, same links, no separate mobile list (globals.css,
   * `table[data-stack]`).
   */
  stack?: boolean;
  /** The scroll region's accessible name. */
  label?: string;
}) {
  return (
    <TableScrollRegion label={label ?? props["aria-label"]}>
      <table
        data-stack={stack ? "" : undefined}
        className={cn(
          "w-full border-collapse text-table",
          /* Inside a card the outer columns align to the card's own padding
             instead of adding a second inset (§20). */
          flush &&
            "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0",
          className,
        )}
        {...props}
      />
      {stack ? <TableStackLabels /> : null}
    </TableScrollRegion>
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TableRow({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-row-hover",
        interactive && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-left text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

/** §57: 48–52px rows keep operational tables dense without feeling cramped. */
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td className={cn("h-12 px-4 align-middle text-fg", className)} {...props} />
  );
}
