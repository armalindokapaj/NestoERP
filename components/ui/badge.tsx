import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

/*
 * The status badge (UI-02 §10.3): a label, and an icon only where it means
 * something. The domain state picks the tone, never the other way round —
 * `default` and `neutral` for draft, archived and cancelled; `info` for in
 * review; `success` approved or completed; `warning` overdue or needing
 * attention; `danger` rejected or failed (lib/utils/status.ts holds the map).
 * Each tone is a `-strong` text colour on its soft ground, measured in both
 * versions and schemes (lib/a11y/contrast-pairs.ts).
 *
 * Not a control: no hover cue, no pointer, no focus (§9.1). A badge that opens
 * something is a button that contains one.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium max-w-full look2:font-mono look2:uppercase look2:tracking-[0.06em]",
  {
    variants: {
      /* nowrap keeps a short status on one line; `wrap` lets a long label break instead of overflowing (MOB-01 §35). */
      wrap: {
        false: "whitespace-nowrap",
        true: "rounded-xl whitespace-normal [overflow-wrap:anywhere]",
      },
      tone: {
        default: "border-line bg-surface-muted text-fg-muted",
        neutral: "border-line-strong bg-hover text-fg",
        success: "border-transparent bg-success-soft text-success-strong",
        warning: "border-transparent bg-warning-soft text-warning-strong",
        danger: "border-transparent bg-danger-soft text-danger-strong",
        info: "border-transparent bg-info-soft text-info-strong",
      },
    },
    defaultVariants: { tone: "default", wrap: false },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** A 12px icon before the label. Decoration: the label carries the state on its own. */
    icon?: React.ReactNode;
  };

export function Badge({ className, tone, wrap, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, wrap }), className)} {...props}>
      {icon ? <span aria-hidden="true" className="inline-flex shrink-0 [&_svg]:size-3">{icon}</span> : null}
      {children}
    </span>
  );
}
