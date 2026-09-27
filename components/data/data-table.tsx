import * as React from "react";
import { ChevronRight } from "lucide-react";
import Link from "@/components/navigation/nav-link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { SortHeaderCell, type TableSortConfig } from "@/components/data/sort-header";
import { TableColumnsScope } from "@/components/data/table-columns";
import { TableSortSelect } from "@/components/data/table-sort-select";
import type { ColumnMeta, ColumnValueType } from "@/lib/tables/columns";
import { sortChoices } from "@/lib/tables/sort";
import { effectiveHideBelow, isFigureColumn } from "@/lib/tables/visibility";
import { cn } from "@/lib/utils/cn";

export type { TableSortConfig } from "@/components/data/sort-header";
export type { ColumnValueType } from "@/lib/tables/columns";

/**
 * The one NESTO table (PRD #7 §19, §20, §93).
 *
 * Modules configure columns; none of them builds a table of its own. Below the
 * tablet breakpoint the same rows render as cards rather than shrinking a
 * desktop table into something unusable (PRD #7 §86).
 *
 * Presentation metadata (AUD-08 §5): every field below `primary` is optional,
 * so a table that sets none of them renders exactly as before. A table with a
 * `listId` gains the Columns control and keeps the person's choice on this
 * device (`TableColumnsScope`); a column with a `sortKey` gets a header sort
 * control with `aria-sort` (`SortHeaderCell`). Neither ever changes which rows
 * or fields the server sent — they only choose what is drawn.
 *
 * Phones and tablets (AUD-04 §5, MW-05, MW-06) — one render, CSS decides:
 * - Cards: the title is a link stretched over the whole card, with a chevron
 *   saying it opens; every other control on the card (row actions, links in a
 *   value) sits above that link, so a menu or a checkbox never opens the row
 *   and no interactive element is nested in another. Row actions get their
 *   own full-width row under the values. Long codes, filenames and emails wrap
 *   rather than widen the card; amounts wrap only between amount and currency.
 * - Sort: the header is gone on a phone, so the `sortKey` orders become a
 *   labelled Sort select showing the applied order (`TableSortSelect`).
 * - `hideBelow`: a money or number column never hides by width — the table
 *   scrolls in its own region instead; any other column is default-hidden at
 *   that width and the Columns control can show it. A table with no Columns
 *   control shows such a column as a labelled line under the record's title
 *   instead, so no width loses data (`lib/tables/visibility.ts`).
 */
export type TableColumn<T> = {
  key: string;
  label: string;
  /** Hidden below this breakpoint on desktop, and used to order card lines. */
  hideBelow?: "md" | "lg" | "xl";
  align?: "left" | "right";
  render: (record: T) => React.ReactNode;
  /** Shown as the card title on mobile. Exactly one column should set this. */
  primary?: boolean;
  /** Stable column id for preferences and the manifest; defaults to `key` (AUD-08 §5). */
  id?: string;
  /** Cannot be hidden in the Columns control. The primary column always is. */
  mandatory?: boolean;
  /** Optional and off until turned on in the Columns control. */
  defaultHidden?: boolean;
  /**
   * What the cells hold. `status` columns stay on mobile cards even when hidden
   * from the table, with the title and actions (AUD-08 §5, AUD-04).
   */
  valueType?: ColumnValueType;
  /**
   * A server-approved sort stem: `name` for `name-asc` / `name-desc`, or a bare
   * allowlisted value such as `recent`. Makes the header a sort control.
   */
  sortKey?: string;
};

/** The column's stable id (AUD-08 §5). */
export function columnIdOf<T>(column: TableColumn<T>): string {
  return column.id ?? column.key;
}

/** The plain, serializable part of the columns: what the Columns control and the store validate against. */
export function columnMetaOf<T>(columns: readonly TableColumn<T>[]): ColumnMeta[] {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  return columns.map((column) => ({
    id: columnIdOf(column),
    label: column.label,
    mandatory: column === primary || column.mandatory === true,
    defaultHidden: column !== primary && column.mandatory !== true && column.defaultHidden === true,
    ...(column.valueType ? { valueType: column.valueType } : {}),
    ...(column.sortKey ? { sortKey: column.sortKey } : {}),
    ...(column !== primary && effectiveHideBelow(column) ? { hideBelow: effectiveHideBelow(column) } : {}),
  }));
}

const HIDE_CLASS: Record<NonNullable<TableColumn<unknown>["hideBelow"]>, string> = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/** A width-hidden column's line under the title, shown only while the column itself is hidden (no Columns control). */
const LINE_CLASS: Record<NonNullable<TableColumn<unknown>["hideBelow"]>, string> = {
  md: "hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
};

export function DataTable<T>({
  columns,
  records,
  rowKey,
  rowHref,
  caption,
  actions,
  listId,
  sort,
}: {
  columns: TableColumn<T>[];
  records: T[];
  rowKey: (record: T) => string;
  /** Clicking a row opens its detail page (PRD #7 §21). */
  rowHref?: (record: T) => string;
  caption?: string;
  /** Optional trailing cell, typically a row action menu. */
  actions?: (record: T) => React.ReactNode;
  /**
   * Stable list id (`<module>.<list>`, a row of docs/tables/list-manifest.md).
   * Turns on the Columns control and local column preferences (AUD-08 §5).
   */
  listId?: string;
  /** Where header sort controls read and write the sort (AUD-08 §4). Needed only with `sortKey` columns. */
  sort?: TableSortConfig;
}) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary);
  // Cells carry their column id only when preferences can hide them, so a
  // table without a list id renders exactly as it did before AUD-08.
  const colId = (column: TableColumn<T>) => (listId && column !== primary ? columnIdOf(column) : undefined);
  const hideClass = (column: TableColumn<T>) => {
    const below = column === primary ? undefined : effectiveHideBelow(column);
    return below && HIDE_CLASS[below];
  };
  // Without a Columns control, a width-hidden column is read under the title.
  const lines = listId ? [] : secondary.filter((column) => effectiveHideBelow(column) && effectiveHideBelow(column) !== "md");
  const choices = sortChoices(columns, sort?.keys);
  const sortControl = choices.length > 0 ? <TableSortSelect choices={choices} sort={sort ?? {}} label={caption} /> : null;

  const table = (
    <>
      {!listId && sortControl ? <div className="mb-2 flex md:hidden [:root:has([data-list-sort-control])_&]:hidden">{sortControl}</div> : null}

      {/* Desktop and tablet: a real table with semantic headers. */}
      <div className="nesto-card hidden overflow-hidden md:block">
        <Table label={caption}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHead>
            <tr>
              {columns.map((column) => {
                const className = cn(
                  hideClass(column),
                  column.align === "right" && "text-right",
                );
                return column.sortKey ? (
                  <SortHeaderCell
                    key={column.key}
                    label={column.label}
                    sortKey={column.sortKey}
                    sort={sort ?? {}}
                    className={className}
                    colId={colId(column)}
                  />
                ) : (
                  <TableHeaderCell key={column.key} scope="col" className={className} data-col-id={colId(column)}>
                    {column.label}
                  </TableHeaderCell>
                );
              })}
              {actions ? (
                <TableHeaderCell scope="col" className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              ) : null}
            </tr>
          </TableHead>
          <TableBody>
            {records.map((record) => (
              <TableRow key={rowKey(record)} interactive={Boolean(rowHref)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    data-col-id={colId(column)}
                    className={cn(
                      hideClass(column),
                      column.align === "right" && "text-right tabular-nums",
                      // An amount is read whole: the table scrolls rather than break it (AUD-04 §5).
                      column !== primary && isFigureColumn(column) && "whitespace-nowrap",
                    )}
                  >
                    {column === primary && rowHref ? (
                      <Link
                        href={rowHref(record)}
                        className="font-medium text-fg transition-colors hover:text-accent focus-visible:text-accent"
                      >
                        {column.render(record)}
                      </Link>
                    ) : (
                      column.render(record)
                    )}
                    {column === primary
                      ? lines.map((line) => (
                          <span
                            key={line.key}
                            data-width-line={columnIdOf(line)}
                            className={cn("mt-0.5 block text-meta text-fg-subtle [overflow-wrap:anywhere]", LINE_CLASS[effectiveHideBelow(line)!])}
                          >
                            {line.label}: {line.render(record)}
                          </span>
                        ))
                      : null}
                  </TableCell>
                ))}
                {actions ? (
                  <TableCell className="text-right">{actions(record)}</TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: record cards (PRD #7 §86, AUD-04 §5). */}
      <ul className="space-y-2 md:hidden">
        {records.map((record) => (
          <li
            key={rowKey(record)}
            data-record-card
            className={cn(
              "nesto-card relative p-4",
              rowHref && "transition-colors hover:bg-row-hover has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-ring/40",
            )}
          >
            <div className="flex items-start gap-3">
              {/* Long values wrap on a card; a truncated one is shown whole. */}
              <div className="min-w-0 flex-1 text-body font-medium text-fg [overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal">
                {rowHref ? (
                  <Link
                    href={rowHref(record)}
                    data-card-link
                    className="transition-colors after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] hover:text-accent focus-visible:outline-none"
                  >
                    {primary.render(record)}
                  </Link>
                ) : (
                  primary.render(record)
                )}
              </div>
              {rowHref ? <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" /> : null}
            </div>
            <dl className="mt-2 space-y-1 [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">
              {secondary.map((column) => (
                <div
                  key={column.key}
                  // Status stays on the card whatever the table shows (AUD-08 §5).
                  data-col-id={column.valueType === "status" ? undefined : colId(column)}
                  className="flex items-baseline gap-2 text-table"
                >
                  <dt className="shrink-0 text-fg-subtle">{column.label}</dt>
                  <dd
                    className={cn(
                      "min-w-0 text-fg-muted",
                      isFigureColumn(column)
                        ? "tabular-nums"
                        : "[overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal",
                    )}
                  >
                    {column.render(record)}
                  </dd>
                </div>
              ))}
            </dl>
            {actions ? (
              // Above the stretched title link: acting on a row never opens it. A row with
              // no action (a voided payment) draws no empty strip.
              <div data-card-actions className="relative z-10 mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3 empty:hidden">
                {actions(record)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );

  if (!listId) return table;
  return (
    <TableColumnsScope listId={listId} columns={columnMetaOf(columns)} label={caption} leading={sortControl}>
      {table}
    </TableColumnsScope>
  );
}
