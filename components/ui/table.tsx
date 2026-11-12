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
 *
 * UI-02 §12.1, §12.2: a semantic table, not a grid. Rows are divided by one
 * subtle line and no cell is boxed; a row is at least the density's height
 * (`--nesto-height-row`: 48px in version 1; 44px, 36px compact and 48px under
 * touch in version 2) and grows for wrapped content. `numeric` right-aligns a
 * column in tabular numerals; `selected` marks a row; `sort` says how a column
 * is ordered.
 */
export function Table({
  className,
  flush = false,
  stack = false,
  stackInset = !flush,
  stickyFirst = !stack,
  label,
  ...props
}: React.ComponentProps<"table"> & {
  flush?: boolean;
  /**
   * On a phone each row becomes a card: the first cell is its title, the rest
   * are "label  value" lines taken from the column headings. Above `md` it is
   * the table. Same rows, same links, no separate mobile list (globals.css,
   * `table[data-stack]`). `"lg"` keeps the cards on a tablet too, for a table
   * too wide for 768–1023px; from `lg` it is the table either way.
   */
  stack?: boolean | "lg";
  /**
   * Whether the stacked cards keep a side inset of their own. By default only
   * a table that is not `flush` does (a `flush` table sits in a card's own
   * padding); a `flush` table in a card without padding (`p-0`) passes `true`.
   */
  stackInset?: boolean;
  /**
   * Below `lg`, where a table scrolls sideways, its first column stays in
   * place while the rest scrolls under it, so every row keeps its name; the
   * edge it continues past fades, so you can see there is more
   * (docs/ui/UI-04-navigation-layouts.md §Phone). On by default for a table
   * that does not stack into cards; pass `false` for one whose first column
   * should scroll too. From `lg` the table is drawn as ever.
   */
  stickyFirst?: boolean;
  /** The scroll region's accessible name. */
  label?: string;
}) {
  return (
    <TableScrollRegion label={label ?? props["aria-label"]}>
      <table
        data-stack={stack === "lg" ? "lg" : stack ? "" : undefined}
        data-flush={stack && !stackInset ? "" : undefined}
        data-sticky-first={stickyFirst ? "" : undefined}
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
        "sticky top-0 z-10 border-b bg-surface/95 backdrop-blur-sm border-fg",
        // Version 2: a sticky layer is a solid ground, so no row shows through it (UI-02 §6.3).
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

/**
 * A row. Hover is the quiet tint; in version 2 focus anywhere inside it tints
 * it the same way, so a keyboard reader sees which row a link or a checkbox
 * belongs to (UI-02 §9.1).
 *
 * `selected` is the row whose checkbox is ticked. The cue is a tint and a rule
 * down its leading edge — never colour alone — and it wins over hover: a
 * selected row looks selected wherever the pointer is (§9). The checkbox, not
 * the row, is what says "selected" to a screen reader, so the row carries no
 * `aria-selected`, which belongs to a grid.
 */
export function TableRow({
  className,
  interactive = false,
  selected = false,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      data-selected={selected ? "" : undefined}
      className={cn(
        "transition-colors hover:bg-row-hover",
        "data-[selected]:bg-accent-soft data-[selected]:hover:bg-accent-soft data-[selected]:focus-within:bg-accent-soft data-[selected]:[&>:first-child]:shadow-[inset_2px_0_0_var(--nesto-accent)]",
        interactive && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Whether a click on an `interactive` row should open its record: a plain left
 * click that did not land on something of the row's own (a link, a button, a
 * field, a menu) and did not end a text selection.
 */
export function opensRow(event: React.MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest("a, button, input, select, textarea, [role='menu'], [role='menuitem'], [role='dialog']")) return false;
  return !window.getSelection()?.toString();
}

/** How a column is ordered; `none` is a sortable column that is not the current order. */
export type TableSort = "ascending" | "descending" | "none";

export function TableHeaderCell({
  className,
  numeric = false,
  sort,
  ...props
}: React.ComponentProps<"th"> & {
  /** A column of amounts or counts: right-aligned, like its cells. */
  numeric?: boolean;
  /** Announced as `aria-sort`. The control that changes it is the caller's (components/data/sort-header.tsx). */
  sort?: TableSort;
}) {
  return (
    <th
      aria-sort={sort}
      className={cn(
        "h-(--nesto-height-row-head) px-4 text-left text-micro uppercase text-fg-subtle font-mono font-medium tracking-[0.1em]",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

/**
 * §57: 48–52px rows keep operational tables dense without feeling cramped.
 * `numeric` is for amounts and counts: right-aligned, in tabular numerals, so
 * a column of figures lines up digit under digit (UI-02 §12.1).
 *
 * The height is a minimum. Version 2 also pads the cell above and below
 * (`--nesto-space-cell-y`: 8px, 4px compact, none in version 1), so a cell
 * that wraps to two lines grows the row instead of touching its dividers (§6.4).
 */
export function TableCell({ className, numeric = false, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td className={cn("h-(--nesto-height-row) px-4 py-(--nesto-space-cell-y) align-middle text-fg", numeric && "text-right tabular-nums", className)} {...props} />
  );
}
