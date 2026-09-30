import * as React from "react";

import { cn } from "@/lib/utils/cn";

const statusRail = {
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
  info: "before:bg-info",
} as const;

/**
 * The card (MOB-01 §17). Padding follows `--nesto-space-card` (16 on a phone,
 * 20 from 640), never a fixed desktop width. Optional states:
 *
 * - `interactive`: the whole card is a target — hover, pressed and a focus ring
 *   (give it `tabIndex`/role or wrap a link; the class only styles it);
 * - `selected` / `disabled`: `aria-selected`-style ring, muted and inert;
 * - `compact`: tighter padding for dense columns;
 * - `status`: a 3px leading rail. It repeats what a visible label says and
 *   never carries meaning alone;
 * - `loading`: `aria-busy`, content dimmed.
 */
export function Card({
  className,
  interactive,
  selected,
  disabled,
  compact,
  loading,
  status,
  ...props
}: React.ComponentProps<"div"> & {
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  status?: keyof typeof statusRail;
}) {
  return (
    <div
      data-compact={compact ? "" : undefined}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "nesto-card group/card min-w-0",
        interactive && !disabled && "cursor-pointer transition-colors hover:bg-row-hover active:bg-hover focus-visible:outline-2",
        selected && "border-accent ring-1 ring-accent",
        disabled && "pointer-events-none opacity-60",
        loading && "opacity-70",
        status && ["relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']", statusRail[status]],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 px-[var(--nesto-space-card)] pt-4 pb-3 group-data-[compact]/card:pt-3 group-data-[compact]/card:pb-2", className)}
      {...props}
    />
  );
}

/**
 * A card's heading (AUD-11 §3, AV-02). An h2 by default, because a card sits
 * directly under the page's h1; `as` picks the level that fits the outline
 * ("h3" for a card inside a titled section, "p" for a label that is not a
 * heading). The look is the same whatever the element: the level is structure,
 * never font size.
 */
export function CardTitle({
  className,
  as: Heading = "h2",
  ...props
}: React.ComponentProps<"h2"> & { as?: "h2" | "h3" | "h4" | "p" }) {
  return <Heading className={cn("text-card font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-table text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-[var(--nesto-space-card)] pb-[var(--nesto-space-card)] group-data-[compact]/card:pb-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 border-t border-line px-[var(--nesto-space-card)] py-3", className)}
      {...props}
    />
  );
}
