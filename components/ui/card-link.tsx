import * as React from "react";

import Link from "@/components/navigation/nav-link";
import { cn } from "@/lib/utils/cn";

/**
 * A navigable card's destination (UI-02 §11.2; `navigable` on Card): a real
 * anchor, so it can be opened in a new tab, copied and followed with Enter.
 * Its `::after` covers the card, which is what makes the whole card a target;
 * the anchor itself stays where its text is, so that text is its accessible
 * name. It draws no focus ring of its own — the card it covers does.
 *
 * In a file of its own so that Card, which every surface uses, does not bring
 * the navigation layer with it.
 */
export function CardLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-card-link=""
      className={cn("rounded-sm text-inherit after:absolute after:inset-0 after:content-[''] focus-visible:outline-none", className)}
      {...props}
    />
  );
}
