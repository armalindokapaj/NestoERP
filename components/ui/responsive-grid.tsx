import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * ResponsiveGrid (MOB-01 §16, §19): the one grid that collapses predictably.
 *
 * `cols` names the column count at each breakpoint; anything not named
 * inherits from the smaller size, so `{ base: 1, md: 2, xl: 3 }` reads
 * "one column on a phone, two from 768, three from 1200". Item widths never
 * exceed the container (`min-w-0`), so a long name or a wide child cannot force
 * page-level scrolling.
 *
 * Use `minItemWidth` instead when the count should follow the room a
 * container has rather than a breakpoint: the grid fits as many columns of at
 * least that width as it can, and `min(100%, …)` keeps one column valid at 320.
 */
type Columns = 1 | 2 | 3 | 4 | 5 | 6;
type ColsSpec = { base?: Columns; sm?: Columns; md?: Columns; lg?: Columns; xl?: Columns; "2xl"?: Columns };

const base = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" } as const;
const sm = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" } as const;
const md = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6" } as const;
const lg = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as const;
const xl = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" } as const;
const x2 = { 1: "2xl:grid-cols-1", 2: "2xl:grid-cols-2", 3: "2xl:grid-cols-3", 4: "2xl:grid-cols-4", 5: "2xl:grid-cols-5", 6: "2xl:grid-cols-6" } as const;

const gaps = { 2: "gap-2", 3: "gap-3", 4: "gap-4", 5: "gap-5", 6: "gap-6" } as const;

/** The class list for a column spec; exported so the mapping can be tested. */
export function gridColumnClasses(cols: ColsSpec): string[] {
  const out: string[] = [base[cols.base ?? 1]];
  if (cols.sm) out.push(sm[cols.sm]);
  if (cols.md) out.push(md[cols.md]);
  if (cols.lg) out.push(lg[cols.lg]);
  if (cols.xl) out.push(xl[cols.xl]);
  if (cols["2xl"]) out.push(x2[cols["2xl"]]);
  return out;
}

export type ResponsiveGridProps = React.ComponentProps<"div"> & {
  cols?: ColsSpec;
  /** Fit as many columns as the container allows, each at least this wide (CSS length, e.g. "16rem"). */
  minItemWidth?: string;
  gap?: keyof typeof gaps;
};

export function ResponsiveGrid({ cols = { base: 1, md: 2, xl: 3 }, minItemWidth, gap = 4, className, style, ...props }: ResponsiveGridProps) {
  return (
    <div
      className={cn("grid min-w-0 [&>*]:min-w-0", gaps[gap], minItemWidth ? undefined : gridColumnClasses(cols), className)}
      style={minItemWidth ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minItemWidth}), 1fr))`, ...style } : style}
      {...props}
    />
  );
}

/**
 * Two columns from md, one on a phone: the standard form layout (MOB-01 §19).
 * A field that needs the whole row takes `className="md:col-span-2"`.
 */
export function FormGrid({ className, ...props }: Omit<ResponsiveGridProps, "cols" | "minItemWidth">) {
  return <ResponsiveGrid cols={{ base: 1, md: 2 }} gap={4} className={className} {...props} />;
}
