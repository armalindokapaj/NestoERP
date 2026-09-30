import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Stack: a flex row or column with a token gap (MOB-01 §15).
 *
 * The responsive case is `stackBelow`: a row from that breakpoint up, a
 * column under it. With `reverseWhenStacked` the DOM order stays the
 * desktop order (Cancel, Save) while the phone shows the primary action on
 * top; `fillWhenStacked` makes each child full width there, so a phone
 * button row becomes stacked full-width actions.
 *
 *   <Stack direction="row" stackBelow="sm" reverseWhenStacked fillWhenStacked justify="end">
 *     <Button variant="secondary">Cancel</Button>
 *     <Button>Save changes</Button>
 *   </Stack>
 */
export type StackDirection = "row" | "column";
export type StackBreakpoint = "sm" | "md" | "lg";

const gaps = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 5: "gap-5", 6: "gap-6", 8: "gap-8" } as const;
export type StackGap = keyof typeof gaps;

const align = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" } as const;
const justify = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" } as const;

/** Row from the breakpoint up; the class strings are literal so Tailwind sees them. */
const rowFrom = { sm: "flex-col sm:flex-row", md: "flex-col md:flex-row", lg: "flex-col lg:flex-row" } as const;
const rowFromReversed = { sm: "flex-col-reverse sm:flex-row", md: "flex-col-reverse md:flex-row", lg: "flex-col-reverse lg:flex-row" } as const;
const fill = { sm: "max-sm:[&>*]:w-full", md: "max-md:[&>*]:w-full", lg: "max-lg:[&>*]:w-full" } as const;
/* Under the breakpoint a stacked column stretches its children; from it they align as asked. */
const stretchBelow = { sm: "max-sm:items-stretch", md: "max-md:items-stretch", lg: "max-lg:items-stretch" } as const;

export type StackProps<T extends React.ElementType = "div"> = {
  as?: T;
  direction?: StackDirection;
  gap?: StackGap;
  align?: keyof typeof align;
  justify?: keyof typeof justify;
  wrap?: boolean;
  /** Only with `direction="row"`: stack as a column below this breakpoint. */
  stackBelow?: StackBreakpoint;
  reverseWhenStacked?: boolean;
  fillWhenStacked?: boolean;
} & Omit<React.ComponentPropsWithoutRef<T>, "as">;

export function Stack<T extends React.ElementType = "div">({
  as,
  direction = "column",
  gap = 4,
  align: alignItems,
  justify: justifyContent,
  wrap = false,
  stackBelow,
  reverseWhenStacked = false,
  fillWhenStacked = false,
  className,
  ...props
}: StackProps<T>) {
  const Comp: React.ElementType = as ?? "div";
  const responsive = direction === "row" && stackBelow;
  return (
    <Comp
      className={cn(
        "flex min-w-0",
        responsive ? (reverseWhenStacked ? rowFromReversed[stackBelow] : rowFrom[stackBelow]) : direction === "row" ? "flex-row" : "flex-col",
        gaps[gap],
        alignItems ? align[alignItems] : undefined,
        justifyContent ? justify[justifyContent] : undefined,
        responsive && alignItems !== "stretch" && stretchBelow[stackBelow],
        wrap && !responsive && "flex-wrap",
        responsive && wrap && (stackBelow === "sm" ? "sm:flex-wrap" : stackBelow === "md" ? "md:flex-wrap" : "lg:flex-wrap"),
        responsive && fillWhenStacked && fill[stackBelow],
        className,
      )}
      {...props}
    />
  );
}
