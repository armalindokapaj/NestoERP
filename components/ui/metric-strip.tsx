import * as React from "react";

import Link from "@/components/navigation/nav-link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

/**
 * The metric strip (UI-02 §11.1): a row of figures read against each other —
 * a financial or operational summary — as one bordered surface with hairlines
 * between its cells, squared inside and rounded only at the outer corners
 * (§6.3). No icon tile, no coloured bar: the figure is the content.
 *
 * A description list, because that is what it is: each cell is a term and its
 * value. Cells are at least 13rem and share the row equally, so the strip is
 * four or five across on a desktop, two on a tablet and one on a phone —
 * where two would break a seven-figure amount in the middle — without a
 * breakpoint of its own.
 */
export function MetricStrip({ className, children, ...props }: React.ComponentProps<"dl">) {
  return (
    <div data-metric-strip="" className="nesto-card min-w-0 overflow-hidden">
      {/* Every cell draws its right and bottom hairline; the last ones fall outside the clip. */}
      <dl className={cn("-mb-px -mr-px grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]", className)} {...props}>
        {children}
      </dl>
    </div>
  );
}

const comparisonTones = {
  neutral: "text-fg-muted",
  success: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
} as const;

/**
 * One figure of a strip: its label, the value in the metric size with tabular
 * numerals (30/36, 26/32 in compact density), the period or scope it covers,
 * and a comparison where a valid one exists. The value is never clipped: a
 * long amount wraps (§11.1).
 *
 * `href` is the drill-down, given only when a filtered list behind the figure
 * exists. The label is then a real link stretched over the cell, so the whole
 * cell opens it; hover is the quiet row tint and an underline, and keyboard
 * focus rings the cell from inside, where the strip's clip cannot cut it.
 * Without `href` the cell is informational and shows no action styling (§9.1).
 */
export function MetricCell({
  label,
  value,
  scope,
  comparison,
  comparisonTone = "neutral",
  href,
  loading = false,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  /** What the figure covers: "This month", "All companies". */
  scope?: React.ReactNode;
  /** Against what, in words: "+4 since last week". The tone repeats what the words say, never replaces them. */
  comparison?: React.ReactNode;
  comparisonTone?: keyof typeof comparisonTones;
  href?: string;
  /** The value is on its way: its room is held, so nothing moves when it arrives. */
  loading?: boolean;
}) {
  return (
    <div
      aria-busy={loading || undefined}
      className={cn(
        "relative min-w-0 border-b border-r border-line px-(--nesto-space-card) py-3 look2:border-b-0 look2:px-4 look2:pb-1 look2:pt-3",
        href &&
          "transition-colors hover:bg-row-hover has-[[data-metric-link]:focus-visible]:outline-2 has-[[data-metric-link]:focus-visible]:-outline-offset-2 has-[[data-metric-link]:focus-visible]:outline-ring",
        className,
      )}
      {...props}
    >
      <dt className="text-meta font-medium text-fg-muted look2:font-mono look2:text-micro look2:uppercase look2:tracking-[0.1em]">
        {href ? (
          <Link
            href={href}
            data-metric-link=""
            className="text-inherit underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
          >
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1 text-metric font-semibold text-fg [overflow-wrap:anywhere] look2:mt-1.5 look2:font-display look2:text-[2.5rem] look2:leading-none look2:font-medium">
        {loading ? <Skeleton aria-hidden="true" className="h-[calc(var(--nesto-text-metric)*var(--nesto-leading-metric))] w-24 max-w-full" /> : value}
      </dd>
      {scope || comparison ? (
        <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 text-meta text-fg-subtle">
          {scope ? <span>{scope}</span> : null}
          {comparison ? <span className={cn("font-medium", comparisonTones[comparisonTone])}>{comparison}</span> : null}
        </dd>
      ) : null}
    </div>
  );
}
