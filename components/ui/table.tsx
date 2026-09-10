import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Table (design spec §21, §22, §23, §57, §79).
 *
 * Flat, minimal separators, no vertical rules. The header sticks while the
 * body scrolls, and wide tables scroll horizontally inside their own container
 * rather than pushing the page sideways (§79).
 */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-table", className)}
        {...props}
      />
    </div>
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
