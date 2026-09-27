import * as React from "react";

import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("nesto-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}
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
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-line px-5 py-3", className)}
      {...props}
    />
  );
}
