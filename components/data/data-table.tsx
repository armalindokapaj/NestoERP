import * as React from "react";
import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";

/**
 * The one NESTO table (PRD #7 §19, §20, §93).
 *
 * Modules configure columns; none of them builds a table of its own. Below the
 * tablet breakpoint the same rows render as cards rather than shrinking a
 * desktop table into something unusable (PRD #7 §86).
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
};

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
}: {
  columns: TableColumn<T>[];
  records: T[];
  rowKey: (record: T) => string;
  /** Clicking a row opens its detail page (PRD #7 §21). */
  rowHref?: (record: T) => string;
  caption?: string;
  /** Optional trailing cell, typically a row action menu. */
  actions?: (record: T) => React.ReactNode;
}) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary);

  return (
    <>
      {/* Desktop and tablet: a real table with semantic headers. */}
      <div className="nesto-card hidden overflow-hidden md:block">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHead>
            <tr>
              {columns.map((column) => (
                <TableHeaderCell
                  key={column.key}
                  scope="col"
                  className={cn(
                    column.hideBelow && HIDE_CLASS[column.hideBelow],
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.label}
                </TableHeaderCell>
              ))}
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
                    <div key={column.key} className="flex items-baseline gap-2 text-table">
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
}
