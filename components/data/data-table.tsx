import * as React from "react";
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
import type { ColumnMeta, ColumnValueType } from "@/lib/tables/columns";
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
  }));
}

const HIDE_CLASS: Record<NonNullable<TableColumn<unknown>["hideBelow"]>, string> = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
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

  const table = (
    <>
      {/* Desktop and tablet: a real table with semantic headers. */}
      <div className="nesto-card hidden overflow-hidden md:block">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHead>
            <tr>
              {columns.map((column) => {
                const className = cn(
                  column.hideBelow && HIDE_CLASS[column.hideBelow],
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
                      column.hideBelow && HIDE_CLASS[column.hideBelow],
                      column.align === "right" && "text-right tabular-nums",
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

      {/* Mobile: record cards (PRD #7 §86). */}
      <ul className="space-y-2 md:hidden">
        {records.map((record) => (
          <li key={rowKey(record)} className="nesto-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium text-fg">
                  {rowHref ? (
                    <Link href={rowHref(record)} className="transition-colors hover:text-accent">
                      {primary.render(record)}
                    </Link>
                  ) : (
                    primary.render(record)
                  )}
                </div>
                <dl className="mt-2 space-y-1">
                  {secondary.map((column) => (
                    <div
                      key={column.key}
                      // Status stays on the card whatever the table shows (AUD-08 §5).
                      data-col-id={column.valueType === "status" ? undefined : colId(column)}
                      className="flex items-baseline gap-2 text-table"
                    >
                      <dt className="shrink-0 text-fg-subtle">{column.label}</dt>
                      <dd className="min-w-0 text-fg-muted">{column.render(record)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {actions ? <div className="shrink-0">{actions(record)}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );

  if (!listId) return table;
  return (
    <TableColumnsScope listId={listId} columns={columnMetaOf(columns)} label={caption}>
      {table}
    </TableColumnsScope>
  );
}
