import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * A titled group on a record's detail page (MOB-04 §8).
 *
 * Title, an optional contextual action ("+ Add", "Edit" — permission-aware, so
 * the page passes it only for someone who may take it), the fields or related
 * content, and an empty state. `collapsible` renders it as a disclosure that is
 * open unless `defaultOpen={false}`: secondary and system information (audit,
 * metadata) lives in collapsed sections; what a person needs to do their work
 * never does (§10). A native `<details>`, so it needs no client code and works
 * with the keyboard and screen readers as is.
 */
export function DetailSection({
  title,
  action,
  collapsible = false,
  defaultOpen = true,
  empty,
  emptyLabel,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** True when there is nothing to show; renders `emptyLabel` in place of the children. */
  empty?: boolean;
  emptyLabel?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = empty ? <p className="text-table text-fg-subtle">{emptyLabel ?? "—"}</p> : children;
  const heading = <h2 className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{title}</h2>;

  if (collapsible) {
    return (
      <details open={defaultOpen} data-detail-section={title} className={cn("nesto-card group p-4 sm:p-5", className)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          {heading}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" />
        </summary>
        {action ? <div className="mt-2 flex justify-end">{action}</div> : null}
        <div className="mt-3">{body}</div>
      </details>
    );
  }

  return (
    <section data-detail-section={title} aria-label={title} className={cn("nesto-card p-4 sm:p-5", className)}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        {heading}
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="mt-3">{body}</div>
    </section>
  );
}
