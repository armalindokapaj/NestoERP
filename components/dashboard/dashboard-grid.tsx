import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Dashboard layout primitives (design spec §17, §40, §51).
 *
 * KPI cards: 4 across from 1024px, 2 on tablet and mobile, 1 only when the
 * screen is too narrow for two to fit (§40).
 *
 * Widgets: a 3-column grid on desktop that folds to 2 on tablet and 1 on
 * mobile. Widget spans are declared alongside it so a "full width" widget
 * stays full width at every size.
 */
export function KpiGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:gap-4 lg:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}

export function DashboardGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        /*
         * Dense flow so a full-width widget followed by a half-width one does
         * not leave a hole at the 2-column stage; the grid backfills instead.
         * Cards are self-labelled, so reading order surviving reflow is enough.
         */
        "grid grid-flow-row-dense gap-4 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
      {...props}
    />
  );
}

/** Widget width, matched to the DashboardGrid columns above. */
export const widgetSpanClasses: Record<1 | 2 | 3, string> = {
  1: "",
  2: "md:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
};
