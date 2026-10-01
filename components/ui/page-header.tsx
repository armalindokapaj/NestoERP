import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Page and section headers (design spec §7, §59).
 * One heading per level, so nothing on the page competes with the title.
 *
 * The action group keeps its width while it fits and wraps inside the page
 * when it does not: `max-w-full` caps a group that is wider than the screen, so
 * three or four buttons at 320px go onto a second row rather than scrolling the
 * page sideways. Every action stays on screen (AUD-04 §3, SP-13, MW-01).
 */
export const headerActionsClass = "flex max-w-full shrink-0 flex-wrap items-center gap-2";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="font-serif font-normal text-page text-fg md:text-display [overflow-wrap:anywhere]">{title}</h1>
        {description ? <p className="mt-1.5 text-body text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className={headerActionsClass}>{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{title}</h2>
        {description ? <p className="mt-0.5 text-table text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className={headerActionsClass}>{actions}</div> : null}
    </div>
  );
}
