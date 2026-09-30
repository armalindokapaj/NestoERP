import * as React from "react";
import { ChevronRight } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { UiText } from "@/components/i18n/ui-text";
import { cn } from "@/lib/utils/cn";

/**
 * Phone record presentations (MOB-03 §9-§13).
 *
 * `MobileRecordCard` is for records with several important facts; the compact
 * `MobileRecordRow` is for identity-first lists (people, contacts, files). Both
 * take already-rendered slots, so they know nothing about a module and can be
 * used by `DataTable`, search results, related lists and selectors alike.
 *
 * Interaction contract, the one the AUD-04 cards already had:
 * - the title is a link stretched over the whole record (`after:absolute
 *   after:inset-0`), so the main area is the target, not a small arrow;
 * - everything else that can be pressed (selection box, row actions, links in a
 *   value) sits above it (`z-10`), so it never opens the record and no control
 *   is nested inside another;
 * - long values wrap instead of widening the record; a figure keeps its digits
 *   together;
 * - `label` is a short spoken summary for the link's accessible name, so a
 *   screen reader hears "Unit A-101, For sale, floor 10" and not a run of cells.
 *
 * Markers `data-record-card`, `data-card-link`, `data-card-actions` are what the
 * responsive specs and the touch-target sweep look for.
 */
export type RecordFact = { key: string; label: string; value: React.ReactNode; figure?: boolean; colId?: string };

export type MobileRecordProps = {
  href?: string;
  title: React.ReactNode;
  /** The secondary context line: the project, the department, the file's folder. */
  subtitle?: React.ReactNode;
  /** Top right: the status badge. */
  status?: React.ReactNode;
  /** A prominent value under the title: the price, the amount. Never truncated. */
  value?: React.ReactNode;
  /** An avatar, file icon or thumbnail with a stable size, so nothing shifts as it loads. */
  leading?: React.ReactNode;
  /** The 2-4 facts that matter; each is a labelled line. */
  facts?: RecordFact[];
  /** Everything else, behind a "More details" disclosure. */
  details?: RecordFact[];
  /** Row actions, drawn above the link. */
  actions?: React.ReactNode;
  /** A selection control, drawn above the link. */
  selection?: React.ReactNode;
  /** Spoken summary used as the link's accessible name. */
  label?: string;
  selected?: boolean;
  className?: string;
  /** A free line under the facts, for content that is not a label and a value. */
  extra?: React.ReactNode;
  /** Test and hook attributes on the record's root element. */
  data?: Record<`data-${string}`, string | undefined>;
};

function FactList({ facts, className }: { facts: RecordFact[]; className?: string }) {
  return (
    <dl className={cn("space-y-1 [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10", className)}>
      {facts.map((fact) => (
        <div key={fact.key} data-col-id={fact.colId} className="flex items-baseline gap-2 text-table">
          <dt className="shrink-0 text-fg-subtle">{fact.label}</dt>
          <dd
            className={cn(
              "min-w-0 text-fg-muted",
              fact.figure ? "tabular-nums" : "[overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal",
            )}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const titleClass = "min-w-0 flex-1 text-body font-medium text-fg [overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal";
const stretchedLink = "transition-colors after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] hover:text-accent focus-visible:outline-none";

export function MobileRecordCard({ href, title, subtitle, status, value, leading, facts = [], details = [], actions, selection, label, selected, className, extra, data }: MobileRecordProps) {
  return (
    <li
      {...data}
      data-record-card
      data-selected={selected || undefined}
      className={cn(
        "nesto-card relative p-4",
        href && "transition-colors hover:bg-row-hover has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-ring/40",
        selected && "border-accent ring-1 ring-accent",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {selection ? <div className="relative z-10 -ml-1 -mt-1 shrink-0">{selection}</div> : null}
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className={titleClass}>
          {href ? (
            <Link href={href} data-card-link aria-label={label} className={stretchedLink}>
              {title}
            </Link>
          ) : (
            title
          )}
          {subtitle ? <div className="mt-0.5 text-table font-normal text-fg-muted">{subtitle}</div> : null}
        </div>
        {status ? <div className="relative z-10 shrink-0">{status}</div> : null}
        {href && !status ? <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" /> : null}
      </div>

      {value ? <div className="mt-2 flex items-center justify-between gap-2 text-card font-semibold tabular-nums text-fg">{value}{href && status ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /> : null}</div> : null}
      {facts.length > 0 ? <FactList facts={facts} className="mt-2" /> : null}
      {extra}

      {details.length > 0 ? (
        <details className="group relative z-10 mt-2">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 text-table font-medium text-accent-strong touch:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
            <UiText k="moreDetails" />
          </summary>
          <FactList facts={details} className="mt-1" />
        </details>
      ) : null}

      {actions ? (
        <div data-card-actions className="relative z-10 mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3 empty:hidden">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The compact pattern: one tight block, identity first, a trailing chevron.
 * At least 56px tall so the whole row is a comfortable target.
 */
export function MobileRecordRow({ href, title, subtitle, status, value, leading, facts = [], actions, selection, label, selected, className, data }: MobileRecordProps) {
  const meta = facts.map((fact) => fact.value).filter(Boolean);
  return (
    <li
      {...data}
      data-record-card
      data-record-row
      data-selected={selected || undefined}
      className={cn(
        "relative flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 py-2.5 last:border-b-0",
        href && "transition-colors hover:bg-row-hover has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-inset has-[a[data-card-link]:focus-visible]:ring-ring/40",
        selected && "bg-accent-soft",
        className,
      )}
    >
      {selection ? <div className="relative z-10 shrink-0">{selection}</div> : null}
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-body font-medium text-fg [overflow-wrap:anywhere] [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal">
          {href ? (
            <Link href={href} data-card-link aria-label={label} className={stretchedLink}>
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {subtitle ? <div className="mt-0.5 truncate text-table text-fg-muted">{subtitle}</div> : null}
        {meta.length > 0 ? (
          <div className="mt-0.5 truncate text-meta text-fg-subtle">
            {meta.map((item, index) => (
              <React.Fragment key={facts[index]?.key ?? index}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                {item}
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>
      {status ? <div className="relative z-10 shrink-0">{status}</div> : null}
      {value ? <div className="shrink-0 text-body font-semibold tabular-nums text-fg">{value}</div> : null}
      {actions ? <div data-card-actions className="relative z-10 shrink-0 empty:hidden">{actions}</div> : null}
      {href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /> : null}
    </li>
  );
}
